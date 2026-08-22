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

/** Add a project. Throws on a duplicate id rather than quietly replacing a working recipe. */
export function addProject(project: Project): void {
  const database = db();
  if (database.prepare("SELECT 1 FROM projects WHERE id = ?").get(project.id)) {
    throw new Error(`A project called "${project.id}" already exists.`);
  }
  insert(database, project);
}
