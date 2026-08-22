import { deleteSession, getSessionMessages, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { replayEvents } from "@/agent/sdk/transcript.ts";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** One stored chat, as the same event stream the browser folds when it is live. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const messages = await getSessionMessages(id).catch(() => null);
  if (!messages) return Response.json({ message: "No such chat." }, { status: 404 });
  return Response.json({ events: replayEvents(messages) });
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const { title } = (await request.json()) as { title?: unknown };
  if (typeof title !== "string" || title.trim().length === 0) {
    return Response.json({ message: "title is required" }, { status: 400 });
  }
  await renameSession(id, title.trim());
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;
  await deleteSession(id);
  return Response.json({ ok: true });
}
