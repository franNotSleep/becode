/**
 * The project store: seeding from the file, round-tripping a recipe, and refusing a duplicate id.
 *
 * node --experimental-strip-types agent/lib/db.check.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "becode-db-")), "becode.db");
process.env.BECODE_DB = file;

const { addProject, allProjects, findProject } = await import("./db.ts");
const { projects: seed } = await import("../../becode.projects.ts");

// First open on a fresh machine takes becode.projects.ts as the starting set, whole.
assert.deepEqual(allProjects().map((p) => p.id), seed.map((p) => p.id));
assert.deepEqual(findProject(seed[0].id), seed[0]);
assert.throws(() => findProject("nope"), /Unknown project "nope"/);

// A recipe the agent worked out is a row like any other, and survives the round trip intact.
const discovered = {
  id: "scraper",
  path: "/tmp/scraper",
  baseBranch: "main",
  install: "npm ci",
  apps: [{ name: "web", command: "npm run dev -- --port $PORT", port: 5173 }],
  services: [{ name: "queue", command: "docker compose up -d" }],
  designSystem: ["src/styles/tokens.css"],
};
addProject(discovered);
assert.deepEqual(findProject("scraper"), discovered);
assert.equal(allProjects().length, seed.length + 1);

// A duplicate id would silently replace a working recipe, so it does not.
assert.throws(() => addProject(discovered), /already exists/);

// Seeding happens once: a second open of the same file must not double up.
assert.equal(allProjects().filter((p) => p.id === seed[0].id).length, 1);

fs.rmSync(path.dirname(file), { recursive: true, force: true });
console.log("db: ok");
