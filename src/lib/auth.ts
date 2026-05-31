import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { getSupabase } from "./supabase";

export const SESSION_COOKIE = "wpai_session";
const SESSION_DAYS = 7;

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

// ---- password hashing (scrypt; stored as "saltHex:hashHex") ----
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// ---- session token: base64url(payload).hmac(payload) ----
function signPart(part: string): string {
  return createHmac("sha256", authSecret()).update(part).digest("base64url");
}

export function createSessionToken(email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400_000 })
  ).toString("base64url");
  return `${payload}.${signPart(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): { email: string } | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = signPart(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!email || typeof exp !== "number" || Date.now() > exp) return null;
    return { email };
  } catch {
    return null;
  }
}

// ---- request/response helpers (route handlers) ----
export function getSessionUser(): { email: string } | null {
  return verifySessionToken(cookies().get(SESSION_COOKIE)?.value);
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export function sessionSetCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function sessionClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// ---- authorized-users allowlist (server-side, service_role) ----
export interface AuthorizedUser {
  email: string;
  password_hash: string;
  name: string | null;
}

export async function findAuthorizedUser(email: string): Promise<AuthorizedUser | null> {
  const { data, error } = await getSupabase()
    .from("authorized_users")
    .select("email,password_hash,name")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return (data as AuthorizedUser) ?? null;
}
