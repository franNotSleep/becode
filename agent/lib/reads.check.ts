/**
 * The read boundary, driven directly.
 *
 * The model refusing to try is not evidence that it cannot: these are the verdicts `canUseTool`
 * returns, checked without a session.
 *
 * node --experimental-strip-types agent/lib/reads.check.ts
 */
import assert from "node:assert/strict";
import { canRead } from "./reads.ts";
import { inWorktree } from "./task.ts";

const deny = (d: ReturnType<typeof canRead>) => (d.allow ? "" : d.message);

const nothing = {};
const working = { task: { worktree: "/tmp/wt/tix/roomier-card" } };
const discovering = { discoveryRoot: "/Users/x/Dev/scraper" };

// No worktree and no folder picked: nothing is readable at all.
assert.match(deny(canRead(nothing, "Read", "package.json")), /no checkout to read yet/);

// Inside a worktree: anything in it, nothing outside it, and Grep is how the agent finds things.
assert.ok(canRead(working, "Read", "apps/web/page.tsx").allow);
assert.ok(canRead(working, "Grep", undefined).allow);
assert.match(deny(canRead(working, "Read", "../../../etc/passwd")), /Only files inside/);
assert.match(deny(canRead(working, "Read", "/Users/x/Dev/becode/.env.local")), /Only files inside/);
// The worktree's own env is the app's config, copied there by createWorktree. Readable.
assert.ok(canRead(working, "Read", ".env").allow);
assert.ok(canRead(working, "Read", "apps/api/.env.local").allow);

// Discovery: one folder, no secrets, no content search.
assert.ok(canRead(discovering, "Read", "package.json").allow);
assert.ok(canRead(discovering, "Glob", "**/docker-compose*.yml").allow);
assert.ok(canRead(discovering, "Read", ".env.example").allow);
assert.ok(canRead(discovering, "Read", "config/.env.sample").allow);
assert.match(deny(canRead(discovering, "Read", ".env")), /live secrets/);
assert.match(deny(canRead(discovering, "Read", ".env.local")), /live secrets/);
assert.match(deny(canRead(discovering, "Read", "apps/api/.env.production")), /live secrets/);
assert.match(deny(canRead(discovering, "Grep", ".")), /Searching file contents is not available/);
assert.match(deny(canRead(discovering, "Read", "/etc/passwd")), /Only files inside/);

// A task supersedes the grant: once work starts, the picked folder is no longer a root.
const both = { ...discovering, task: working.task };
assert.match(deny(canRead(both, "Read", "/Users/x/Dev/scraper/package.json")), /Only files inside/);
assert.ok(canRead(both, "Grep", undefined).allow);

// The start_task turn: cwd is still the source checkout, so a relative path is the person's own
// branch and not the worktree at all. The absolute path start_task returned is the way through.
const source = "/Users/x/Dev/tix/web";
assert.match(deny(canRead(working, "Read", "src/app/page.tsx", source)), /Only files inside/);
assert.ok(canRead(working, "Read", "/tmp/wt/tix/roomier-card/src/app/page.tsx", source).allow);
// Glob and Grep with no path search the working directory — which is that same checkout.
assert.match(deny(canRead(working, "Grep", undefined, source)), /Only files inside/);

// The shell is put back in the worktree. `cd` on its own line, or a command whose first line is a
// comment would swallow it; single-quotes escaped, because a home directory may hold one.
assert.equal(inWorktree("# note\nls", "/tmp/wt/a"), "cd '/tmp/wt/a' || exit 1\n# note\nls");
assert.match(inWorktree("ls", "/tmp/it's/a"), /^cd '\/tmp\/it'\\''s\/a' \|\| exit 1\n/);

console.log("reads: ok");
