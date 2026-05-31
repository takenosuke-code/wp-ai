import type { NextRequest } from "next/server";
import {
  findAuthorizedUser,
  verifyPassword,
  createSessionToken,
  sessionSetCookie,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let email = "";
  let password = "";
  try {
    ({ email, password } = await req.json());
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!email || !password) {
    return Response.json({ error: "メールアドレスとパスワードを入力してください" }, { status: 400 });
  }

  // Allowlist check + password verify. Same response for "not in table" and
  // "wrong password" so we don't leak which emails are authorized.
  const user = await findAuthorizedUser(String(email));
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    return Response.json(
      { error: "メールアドレスまたはパスワードが正しくありません" },
      { status: 401 }
    );
  }

  const token = createSessionToken(user.email);
  return new Response(JSON.stringify({ email: user.email, name: user.name }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": sessionSetCookie(token) },
  });
}
