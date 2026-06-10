import { loadConversation, deleteConversation, toDisplay, latestDraft } from "@/lib/conversations";
import { getSessionUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!getSessionUser()) return unauthorized();
  const conv = await loadConversation(params.id);
  if (!conv) return new Response("not found", { status: 404 });
  return Response.json({
    id: conv.id,
    title: conv.title,
    messages: toDisplay(conv.messages),
    draft: latestDraft(conv.messages), // restore the live preview after reload
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!getSessionUser()) return unauthorized();
  await deleteConversation(params.id);
  return new Response(null, { status: 204 });
}
