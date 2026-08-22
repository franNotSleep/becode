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
);`;

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
