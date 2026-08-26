import { deleteSession, getSessionMessages, renameSession } from "@anthropic-ai/claude-agent-sdk";
import { deleteEvents, findProject, loadEvents } from "@/agent/lib/db.ts";
import { removeWorktree } from "@/agent/lib/git.ts";
import { forgetChat } from "@/agent/lib/task.ts";
import { replayEvents } from "@/agent/sdk/transcript.ts";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * One stored chat, as the same event stream the browser folds when it is live.
 *
 * becode's own table first — an indexed query, with images as URLs rather than base64. A chat
 * that predates it has no rows, and falls back to walking the SDK's transcript so the history
 * already on this machine still opens.
 */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;

  const events = loadEvents(id);
  if (events.length > 0) return Response.json({ events });

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

/** Deleting the chat deletes what it was working in: nobody else can reach that worktree. */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params;

  const task = forgetChat(id);
  if (task) {
    try {
      // Already gone, project since removed, whatever — the chat still has to delete.
      await removeWorktree(findProject(task.projectId).path, task.worktree);
    } catch {
      // Nothing the person can do about it from here.
    }
  }

  // The blobs are content-addressed and shared between chats, so they stay.
  // ponytail: a sweeper over unreferenced keys is the upgrade path if the bucket ever matters.
  deleteEvents(id);
  await deleteSession(id);
  return Response.json({ ok: true });
}
