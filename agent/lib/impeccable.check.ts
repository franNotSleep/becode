/**
 * The three states, against real directories.
 *
 * `uncommitted` is the one worth a check: it is invisible from inside a worktree, which is the only
 * place a task ever looks, and getting it wrong sends the person to the wrong command.
 *
 * node --experimental-strip-types agent/lib/impeccable.check.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { impeccableContext } from "./impeccable.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "becode-impeccable-"));
const dir = (name: string) => {
  const made = path.join(root, name);
  fs.mkdirSync(made, { recursive: true });
  return made;
};
const write = (base: string, rel: string) => {
  fs.mkdirSync(path.join(base, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(base, rel), "x");
};

const empty = dir("empty");

// Committed: the worktree carries it, and the files come back for the agent to read.
const worktree = dir("worktree");
write(worktree, "PRODUCT.md");
write(worktree, "DESIGN.md");
write(worktree, ".impeccable/design.json");
assert.deepEqual(impeccableContext(worktree, empty), {
  state: "ready",
  files: ["PRODUCT.md", "DESIGN.md", ".impeccable/design.json"],
});

// Installed but never committed: `git worktree add` copied tracked files only, so the worktree is
// bare while the checkout is not. The fix is a commit, not another install.
const checkout = dir("checkout");
write(checkout, "PRODUCT.md");
assert.deepEqual(impeccableContext(dir("fresh"), checkout), { state: "uncommitted", files: [] });

// Never set up anywhere.
assert.deepEqual(impeccableContext(empty, dir("bare")), { state: "missing", files: [] });

// The fallback context dirs count, and each group resolves on its own — a repo with DESIGN.md in
// docs/ and no PRODUCT.md at all is still ready.
const fallback = dir("fallback");
write(fallback, "docs/DESIGN.md");
assert.deepEqual(impeccableContext(fallback, empty), { state: "ready", files: ["docs/DESIGN.md"] });

// Root wins over the fallbacks, and only one path per group is reported.
const both = dir("both");
write(both, "PRODUCT.md");
write(both, "docs/PRODUCT.md");
assert.deepEqual(impeccableContext(both, empty), { state: "ready", files: ["PRODUCT.md"] });

fs.rmSync(root, { force: true, recursive: true });
console.log("impeccable: ok");
