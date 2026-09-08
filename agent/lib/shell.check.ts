/**
 * The shell refusal: what counts as pushing, and what does not.
 *
 * node --experimental-strip-types agent/lib/shell.check.ts
 */
import assert from "node:assert/strict";
import { inWorktree } from "./task.ts";
import { pushesUpstream } from "./shell.ts";

// The plain spelling.
assert.equal(pushesUpstream("git push"), true);
assert.equal(pushesUpstream("git push origin main"), true);
assert.equal(pushesUpstream("git push --force origin HEAD:refs/heads/x"), true);

// The one becode's own PreToolUse hook produces. This is the case the `disallowedTools` prefix
// rule misses, and the reason this file exists.
assert.equal(pushesUpstream(inWorktree("git push origin main", "/home/becode/.becode/worktrees/x")), true);

// Chained and prefixed forms.
assert.equal(pushesUpstream("cd /tmp && git push"), true);
assert.equal(pushesUpstream("git add -A; git commit -m x; git push"), true);
assert.equal(pushesUpstream("git -C /some/worktree push origin main"), true);
assert.equal(pushesUpstream("GIT_DIR=/x/.git git push"), true);
assert.equal(pushesUpstream("/usr/bin/git push"), true);
assert.equal(pushesUpstream("echo hi | git push"), true);

// Everything the agent legitimately does with git must still run.
for (const fine of [
  "git status --short",
  "git diff --cached --name-only",
  "git add -A",
  'git commit -m "roomier ticket card"',
  "git fetch origin main",
  "git log --oneline -5",
  "git worktree list",
  "git checkout -b becode/roomier",
  "grep -rn 'push' src/",
  "npm run push-check",
  "echo 'git push' >> notes.md",
  "cd /tmp && ls",
]) {
  assert.equal(pushesUpstream(fine), false, `${fine} must still run`);
}

console.log("shell: ok");
