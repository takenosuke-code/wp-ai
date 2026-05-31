import { store } from "@/lib/store";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!getSessionUser()) return unauthorized();
  const posts = await store.list();
  return Response.json(posts);
}
