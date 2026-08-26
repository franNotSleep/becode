/**
 * The store: seeding projects from the file, round-tripping a recipe, refusing a duplicate id,
 * keeping a chat's worktree across the restart that used to lose it, and holding the conversation
 * itself — the record a reopened chat is now replayed from.
 *
 * node --experimental-strip-types agent/lib/db.check.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "becode-db-")), "becode.db");
process.env.BECODE_DB = file;

const { addProject, allProjects, appendEvents, deleteEvents, findProject, loadChatState, loadEvents, moveEvents, saveProject } =
  await import("./db.ts");
const { chatFor, forgetChat, rememberChat, setTask } = await import("./task.ts");
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
  services: [{ name: "queue", command: "docker compose up -d" }, { name: "api", command: "npm run api", port: 4010 }],
  designSystem: ["src/styles/tokens.css"],
};
addProject(discovered);
assert.deepEqual(findProject("scraper"), discovered);
assert.equal(allProjects().length, seed.length + 1);

// A duplicate id would silently replace a working recipe, so it does not.
assert.throws(() => addProject(discovered), /already exists/);

// saveProject is the deliberate edit — a seeded row learning a field it did not have.
saveProject({ ...discovered, baseBranch: "trunk" });
assert.equal(findProject("scraper").baseBranch, "trunk");
assert.equal(allProjects().length, seed.length + 1, "an update is not a second row");
assert.equal(findProject("scraper").services?.[1].port, 4010, "a service port survives the round trip");

// Seeding happens once: a second open of the same file must not double up.
assert.equal(allProjects().filter((p) => p.id === seed[0].id).length, 1);

// A chat keeps its worktree across the process that made it. The Map is a cache, so everything
// here is read back through `chatFor`, which is the only path a resumed turn takes.
const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "becode-wt-"));
const chat = chatFor(undefined);
rememberChat(chat, "session-1");
setTask(chat, { projectId: "scraper", request: "roomier card", worktree, branch: "becode/roomier" });

/** A second module instance is what an HMR reload is: same database file, empty cache. */
const reopen = (n: number) =>
  // The query string is what makes Node load a fresh instance; TS resolves the bare path.
  import(`./task.ts?restart=${n}`) as Promise<typeof import("./task.ts")>;

const { chatFor: freshChatFor } = await reopen(1);
assert.equal(freshChatFor("session-1").task?.worktree, worktree, "a restart keeps the worktree");
assert.equal(freshChatFor("session-1").task?.request, "roomier card");
assert.equal(freshChatFor("unknown").task, null);

// The same chat under a second session id is one row per id, both pointing at the same worktree.
rememberChat(chat, "session-2");
assert.equal(freshChatFor("session-2").task?.worktree, worktree);

// A worktree deleted by hand must not come back as a path every read denies.
fs.rmSync(worktree, { recursive: true, force: true });
const { chatFor: afterRm } = await reopen(2);
assert.equal(afterRm("session-1").task, null, "a missing worktree drops the task");

// Deleting a chat hands back what it owned, so the route can remove the worktree.
setTask(chat, { projectId: "scraper", request: "again", worktree, branch: "becode/again" });
assert.equal(forgetChat("session-1")?.branch, "becode/again");
assert.equal(loadChatState("session-1"), undefined, "the row goes, not just the cache entry");
assert.notEqual(loadChatState("session-2"), undefined, "a sibling id is not collateral");

// The conversation. Events go in as they stream and come back in the order they were produced —
// an image is a URL here, never base64, which is the whole reason this table exists.
appendEvents("chat-a", [
  { type: "user", text: "make it roomier", files: [{ name: "hero.png", mediaType: "image/png", src: "/api/attachments/abc" }] },
  { type: "delta", text: "Looking" },
]);
appendEvents("chat-a", [{ type: "delta", text: " at it." }]);
appendEvents("chat-b", [{ type: "delta", text: "elsewhere" }]);

const replay = loadEvents("chat-a");
assert.equal(replay.length, 3, "every event is a row, in one chat");
assert.deepEqual(replay.map((e) => e.type), ["user", "delta", "delta"], "in the order produced");
assert.equal(replay[0].type === "user" && replay[0].files[0].src, "/api/attachments/abc");
assert.equal(replay[0].type === "user" && replay[0].files[0].name, "hero.png", "the filename survives");
assert.deepEqual(loadEvents("chat-c"), [], "a chat with no rows replays through the SDK instead");

// A fork or a compaction reports a new session id. The history follows it, or the sidebar can
// never reach anything said before.
moveEvents("chat-a", "chat-a2");
assert.equal(loadEvents("chat-a2").length, 3);
assert.deepEqual(loadEvents("chat-a"), []);
assert.equal(loadEvents("chat-b").length, 1, "another chat is not swept along");

deleteEvents("chat-a2");
assert.deepEqual(loadEvents("chat-a2"), []);
assert.equal(loadEvents("chat-b").length, 1, "deleting one chat is not collateral for the next");

fs.rmSync(path.dirname(file), { recursive: true, force: true });
console.log("db: ok");
