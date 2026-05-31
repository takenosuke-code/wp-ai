import { sessionClearCookie } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return new Response(null, { status: 200, headers: { "Set-Cookie": sessionClearCookie() } });
}
