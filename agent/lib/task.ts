import path from "node:path";
import { findProject } from "./db.ts";
import type { Project } from "./projects.ts";

export type Task = {
  projectId: string;
  /** What the person actually asked for, as judged at start_task. Carried for the PR gate. */
  request: string;
  worktree: string;
  branch: string;
} | null;

/**
 * One chat's server-side state.
 *
 * The tools close over this object rather than importing a singleton, because `tool()`'s handler
 * receives `extra: unknown` — the SDK hands it no session id, so there is nothing to look up by.
 * `agent/sdk/tools.ts` is therefore a factory, built once per run around one of these.
 *
 * ponytail: a Map in one process, not a store. becode is one local process serving one person at
 * one screen; nothing here survives a restart, and a task mid-review does not need to.
 * apps/tixqa/server/db.ts is the precedent if that ever changes.
 */
export type Chat = {
  /** Filled from the SDK's init message. Absent until the first turn of a new chat reports one. */
  sessionId?: string;
  /** Chosen in the sidebar before the first message, when the chat was opened on a project. */
  projectId?: string;
  /**
   * A repo the person pointed at so its boot recipe can be worked out. Reads are allowed under
   * this one path while the chat has no task — see the note in `canUseTool`. Cleared once the
   * project is added.
   */
  discoveryRoot?: string;
  task: Task;
};

const chats = new Map<string, Chat>();

/** The state for a chat, resumed by session id or fresh. */
export function chatFor(sessionId: string | undefined): Chat {
  const existing = sessionId ? chats.get(sessionId) : undefined;
  return existing ?? { task: null };
}

/**
 * Key a chat by the session id the SDK just reported.
 *
 * Ids can change across turns, so previous keys are left pointing at the same object rather than
 * deleted — a stale id from the browser must still find its worktree.
 */
export function rememberChat(chat: Chat, sessionId: string): void {
  chat.sessionId = sessionId;
  chats.set(sessionId, chat);
}

export function activeTask(chat: Chat): { task: NonNullable<Task>; project: Project } {
  if (!chat.task) throw new Error("No task started. Call start_task first.");
  return { task: chat.task, project: findProject(chat.task.projectId) };
}

/**
 * Resolve a repo-relative path inside the worktree.
 *
 * Trust boundary: the model supplies this path. Reject anything that escapes the worktree —
 * `..` and absolute paths never reach the filesystem.
 */
export function resolveInWorktree(worktree: string, relPath: string): string {
  const full = path.resolve(worktree, relPath);
  const root = path.resolve(worktree);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the worktree: ${relPath}`);
  }
  return full;
}
