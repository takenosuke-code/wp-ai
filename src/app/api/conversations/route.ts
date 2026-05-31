import { listConversations } from "@/lib/conversations";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!getSessionUser()) return unauthorized();
  return Response.json(await listConversations());
}
