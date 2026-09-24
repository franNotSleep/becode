import fs from "node:fs";
import path from "node:path";
import { deleteChatState, findProject, loadChatState, saveChatState } from "./db.ts";
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
 * The `Map` is a cache in front of a sqlite row, not the record. It used to be the record, and
 * that lost a chat its worktree every time `next dev` re-evaluated this module — the chat resumed
 * (the SDK stores the transcript), came back with `task: null`, and the model had no move left but
 * `start_task`, which cut a second worktree off the base branch and stranded the edits in the
 * first. Same store as the projects: `~/.becode/becode.db`.
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
  /**
   * What this chat has shipped, newest last.
   *
   * An array rather than a field on `Task`, for two reasons: `open_pull_request` ends the task
   * with `setTask(chat, null)` one line after the PR URL arrives, so anything hung off `Task`
   * is destroyed at the exact moment both references first exist; and a chat can start a second
   * task after shipping the first.
   */
  shipped?: Shipped[];
  /**
   * The shipped change this chat builds on, when it was opened with "Continue on top of this".
   *
   * A copy of the parent's last `Shipped`, not a pointer to its row: deleting the parent chat must
   * not strand the child without a base. Resolved on the server from the parent's session id — the
   * browser never names the branch a worktree is cut from.
   */
  parent?: Parent;
};

/** One change that left the machine: the PR, and the Linear issue it was filed under. */
export type Shipped = {
  /** `TIX-123`. Absent when Linear was unreachable or unconfigured — the PR still opened. */
  issue?: string;
  /** Linear's UUID for the issue. `parentId` takes this, not the identifier. */
  issueId?: string;
  issueUrl?: string;
  prUrl: string;
  /** The branch as pushed — `becode/tix-123-<slug>`, not the local `becode/<slug>`. */
  branch: string;
  /** Absent on entries recorded before continuing existed. */
  projectId?: string;
  at: number;
};

export type Parent = {
  sessionId: string;
  projectId: string;
  branch: string;
  issue?: string;
  issueId?: string;
  prUrl: string;
};

const chats = new Map<string, Chat>();

/** The state for a chat, resumed by session id or fresh. */
export function chatFor(sessionId: string | undefined): Chat {
  if (!sessionId) return { task: null };

  const cached = chats.get(sessionId);
  if (cached) return cached;

  const stored = loadChatState(sessionId);
  if (!stored) return { task: null };

  // A worktree someone deleted by hand must not come back as a path every read denies. Dropping
  // the task leaves a chat that can start a new one, which is the only useful state left.
  if (stored.task && !fs.existsSync(stored.task.worktree)) stored.task = null;

  chats.set(sessionId, stored);
  return stored;
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
  saveChatState(sessionId, chat);
}

/**
 * Start or end this chat's task, and write it down.
 *
 * Persisted here rather than at the end of the turn: an HMR reload lands mid-turn as often as
 * between them, and a task that only reaches disk once the turn finishes is the bug this fixes.
 */
export function setTask(chat: Chat, task: Task): void {
  chat.task = task;
  if (chat.sessionId) saveChatState(chat.sessionId, chat);
}

/**
 * Record a change that reached a pull request.
 *
 * Written before `setTask(chat, null)`, never after: the task is the only thing holding the branch
 * the PR was opened on.
 */
export function recordShipped(chat: Chat, entry: Shipped): void {
  chat.shipped = [...(chat.shipped ?? []), entry];
  if (chat.sessionId) saveChatState(chat.sessionId, chat);
}

/**
 * Make `chat` a continuation of what `parentSessionId` shipped last.
 *
 * Only a session id crosses from the browser; the branch, issue and project come from the parent's
 * own stored state, so a request cannot point a worktree at an arbitrary ref.
 */
export function continueFrom(chat: Chat, parentSessionId: string): void {
  const parent = chatFor(parentSessionId);
  const last = parent.shipped?.at(-1);
  if (!last) throw new Error("That chat has not shipped anything to continue from.");
  const projectId = last.projectId ?? parent.projectId;
  if (!projectId) throw new Error("That chat's shipped change has no project on record.");

  chat.projectId = projectId;
  chat.parent = {
    sessionId: parent.sessionId ?? parentSessionId,
    projectId,
    branch: last.branch,
    issue: last.issue,
    issueId: last.issueId,
    prUrl: last.prUrl,
  };
  if (chat.sessionId) saveChatState(chat.sessionId, chat);
}

/**
 * Forget a chat, and hand back what it owned so the caller can clean up after it.
 *
 * Only the row asked for: `rememberChat` keys one chat under every session id it has reported, so
 * siblings are left pointing at a worktree that is about to go. `chatFor` stats before it trusts
 * one, which turns those into `task: null`.
 */
export function forgetChat(sessionId: string): Task {
  const chat = chatFor(sessionId);
  chats.delete(sessionId);
  deleteChatState(sessionId);
  return chat.task;
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
/**
 * Run a command with the worktree as its working directory.
 *
 * `cwd` is fixed when a turn's query starts, so on the turn that calls `start_task` the shell
 * opens in the target repo's source checkout — the person's real branch. This puts it back.
 *
 * `cd` on its own line rather than `cd … && `: a command whose first line is a comment would
 * make `&&` a syntax error. Single-quoted, because a home directory may contain a `$`.
 *
 * ponytail: the default directory, not a boundary. A command is a string and `resolveInWorktree`
 * takes a path, so nothing here stops the model cd-ing straight back out.
 */
export function inWorktree(command: string, worktree: string): string {
  return `cd '${worktree.replaceAll("'", `'\\''`)}' || exit 1\n${command}`;
}

export function resolveInWorktree(worktree: string, relPath: string): string {
  const full = path.resolve(worktree, relPath);
  const root = path.resolve(worktree);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the worktree: ${relPath}`);
  }
  return full;
}
