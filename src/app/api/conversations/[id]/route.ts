import { loadConversation, deleteConversation, toDisplay } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const conv = await loadConversation(params.id);
  if (!conv) return new Response("not found", { status: 404 });
  return Response.json({ id: conv.id, title: conv.title, messages: toDisplay(conv.messages) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await deleteConversation(params.id);
  return new Response(null, { status: 204 });
}
