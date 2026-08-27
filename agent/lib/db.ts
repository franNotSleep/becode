/**
 * Where the projects live.
 *
 * They used to be `becode.projects.ts` and nothing else. That works while a human is the only
 * author, but the agent is meant to work a repo's boot recipe out for itself, and it cannot write
 * becode's own source — that file sits outside every worktree and `canUseTool` refuses it. So the
 * file becomes the seed and this becomes the record.
 *
 * `node:sqlite` ships with Node 24; there is no dependency here. `apps/tixqa/server/db.ts` in the
 * tixdo/web monorepo is the same idea.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projects as seed } from "../../becode.projects.ts";
import type { AgentEvent } from "../sdk/session.ts";
import type { Project } from "./projects.ts";
import type { Chat } from "./task.ts";

const FILE = process.env.BECODE_DB ?? path.join(os.homedir(), ".becode", "becode.db");

/**
 * ponytail: the whole Project as JSON in one column, not six tables with app and service children.
 * Every read is "give me all the projects", and `Project` in projects.ts already owns the shape.
 * Normalise the day something queries by port.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  config     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  session_id TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS messages_session ON messages (session_id, id);`;

let handle: DatabaseSync | undefined;

/** Opened on first use, not at import: `boot.check.ts` imports this tree and starts no servers. */
function db(): DatabaseSync {
  if (handle) return handle;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  handle = new DatabaseSync(FILE);
  handle.exec(SCHEMA);

  // First run on this machine: the file someone hand-wrote is the starting set.
  const [{ n }] = handle.prepare("SELECT COUNT(*) AS n FROM projects").all() as { n: number }[];
  if (n === 0) for (const project of seed) insert(handle, project);

  return handle;
}

function insert(database: DatabaseSync, project: Project): void {
  database
    .prepare("INSERT INTO projects (id, config, created_at) VALUES (?, ?, ?)")
    .run(project.id, JSON.stringify(project), Date.now());
}

export function allProjects(): Project[] {
  return (db().prepare("SELECT config FROM projects ORDER BY created_at").all() as { config: string }[])
    .map((row) => JSON.parse(row.config) as Project);
}

export function findProject(projectId: string): Project {
  const row = db().prepare("SELECT config FROM projects WHERE id = ?").get(projectId) as
    | { config: string }
    | undefined;
  if (!row) {
    throw new Error(
      `Unknown project "${projectId}". Configured: ${allProjects().map((p) => p.id).join(", ")}`,
    );
  }
  return JSON.parse(row.config) as Project;
}

/** Replace a project's recipe, or insert it. For editing a row a seed has already written. */
export function saveProject(project: Project): void {
  db()
    .prepare(
      "INSERT INTO projects (id, config, created_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET config = excluded.config",
    )
    .run(project.id, JSON.stringify(project), Date.now());
}

/** Add a project. Throws on a duplicate id rather than quietly replacing a working recipe. */
export function addProject(project: Project): void {
  const database = db();
  if (database.prepare("SELECT 1 FROM projects WHERE id = ?").get(project.id)) {
    throw new Error(`A project called "${project.id}" already exists.`);
  }
  insert(database, project);
}

/**
 * A chat's server-side state, keyed by session id.
 *
 * The worktree a chat owns used to live only in a `Map`, which `next dev` empties on every HMR
 * reload — the chat came back with `task: null`, so the model's only legal move was `start_task`
 * again and the previous turn's edits were stranded in a directory nobody would look at again.
 * Same JSON-in-a-column shape as `projects`: `Chat` in task.ts already owns it.
 */
export function loadChatState(sessionId: string): Chat | undefined {
  const row = db().prepare("SELECT state FROM chats WHERE session_id = ?").get(sessionId) as
    | { state: string }
    | undefined;
  return row ? (JSON.parse(row.state) as Chat) : undefined;
}

export function saveChatState(sessionId: string, chat: Chat): void {
  db()
    .prepare(
      "INSERT INTO chats (session_id, state, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(session_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at",
    )
    .run(sessionId, JSON.stringify(chat), Date.now());
}

export function deleteChatState(sessionId: string): void {
  db().prepare("DELETE FROM chats WHERE session_id = ?").run(sessionId);
}

/**
 * The conversation itself.
 *
 * The Agent SDK already keeps a transcript on disk, and it stays the resume source — but reading a
 * chat back out of it means parsing a JSONL that reaches double-digit megabytes and re-escaping
 * every attached image into one JSON body. becode keeps its own record: one `AgentEvent` per row,
 * the same events the browser folds live, so replay is an indexed query.
 *
 * ponytail: a row per event, including every `delta`. Coalescing consecutive deltas at write time
 * is the upgrade path if a long chat ever loads slowly.
 */
/**
 * Append events to a chat, and hand back the row id each one landed on.
 *
 * The ids are the cursor a browser reattaching mid-turn resumes from: they are absolute and
 * monotonic, so "everything after what I already have" is a comparison rather than a diff.
 * `moveEvents` keeps them, because it moves rows rather than rewriting them.
 */
export function appendEvents(sessionId: string, events: AgentEvent[]): number[] {
  if (events.length === 0) return [];
  const statement = db().prepare(
    "INSERT INTO messages (session_id, event, created_at) VALUES (?, ?, ?)",
  );
  const at = Date.now();
  return events.map(
    (event) => Number(statement.run(sessionId, JSON.stringify(event), at).lastInsertRowid),
  );
}

/** The cursor a reader has caught up to once it has read this chat's stored events. 0 if none. */
export function lastEventId(sessionId: string): number {
  const [row] = db()
    .prepare("SELECT MAX(id) AS last FROM messages WHERE session_id = ?")
    .all(sessionId) as { last: number | null }[];
  return row?.last ?? 0;
}

/** Every event of a chat, in the order it was produced. Empty for a chat that predates this table. */
export function loadEvents(sessionId: string): AgentEvent[] {
  return (
    db()
      .prepare("SELECT event FROM messages WHERE session_id = ? ORDER BY id")
      .all(sessionId) as { event: string }[]
  ).map((row) => JSON.parse(row.event) as AgentEvent);
}

export function deleteEvents(sessionId: string): void {
  db().prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
}

/** Carry a chat's events to a new session id. The SDK reports one on a fork or a compaction. */
export function moveEvents(from: string, to: string): void {
  db().prepare("UPDATE messages SET session_id = ? WHERE session_id = ?").run(to, from);
}
