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
import { impeccableContext, parseFrontmatter, projectDesign } from "./impeccable.ts";

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

// --- The project row: installed, committed, and the design system itself ---

const design = dir("design");
fs.mkdirSync(path.join(design, ".impeccable"), { recursive: true });
fs.writeFileSync(path.join(design, ".impeccable/config.json"), "{}");
fs.writeFileSync(
  path.join(design, "DESIGN.md"),
  `---
name: Tix
description: Ticketing, plainly
colors:
  primary: "#b8422e"
  neutral-bg: '#faf7f2'
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontWeight: 300
rounded:
  sm: "4px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
---

## Overview
`,
);

// Everything tracked: the row shows the system.
const ready = await projectDesign(design, async () => ["DESIGN.md", ".impeccable/config.json"]);
assert.equal(ready.installed, true);
assert.deepEqual(ready.untracked, []);
assert.equal(ready.system?.name, "Tix");

// The same repo with nothing committed. A worktree is built from tracked files, so this is the
// state that matters most and the one the checkout alone cannot tell you.
const untracked = await projectDesign(design, async () => []);
assert.deepEqual(untracked.untracked, ["DESIGN.md", ".impeccable/config.json"]);

// The installer ran but nothing describes the look yet — real state of `tix` today.
const halfway = dir("halfway");
write(halfway, ".impeccable/config.json");
const half = await projectDesign(halfway, async () => [".impeccable/config.json"]);
assert.equal(half.installed, true);
assert.equal(half.system, null);

// Never set up: no git call is worth making.
assert.deepEqual(await projectDesign(dir("none"), async () => assert.fail("git ran")), {
  installed: false,
  files: [],
  untracked: [],
  system: null,
});

// The reader takes the four keys it draws and stops. Components nest one level deeper than
// typography's properties, and drawing one of its values as a colour would be a lie.
const parsed = parseFrontmatter(`
name: Tix
colors:
  primary: "#b8422e"
  # a comment
  neutral-bg: '#faf7f2'
typography:
  display:
    fontFamily: "Cormorant, serif"
    fontWeight: 300
  body:
    fontFamily: "Inter"
rounded:
  sm: "4px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    typography: "{typography.body}"
    padding: "16px 48px"
`);
assert.deepEqual(parsed.colors, [
  { name: "primary", value: "#b8422e" },
  { name: "neutral-bg", value: "#faf7f2" },
]);
assert.deepEqual(
  parsed.type.map((role) => [role.name, role.family, role.weight]),
  [
    ["display", "Cormorant, serif", "300"],
    ["body", "Inter", undefined],
  ],
);
assert.deepEqual(parsed.rounded, [{ name: "sm", value: "4px" }]);

// Components resolve their `{token.refs}` against the primitives, including into a type role.
assert.deepEqual(parsed.components[0].backgroundColor, "#b8422e");
assert.equal(parsed.components[0].rounded, "4px");
assert.equal(parsed.components[0].type?.family, "Inter");

// A ref pointing at nothing is dropped, never drawn as the literal "{colors.ghost}".
const dangling = parseFrontmatter(`
colors:
  primary: "#b8422e"
components:
  button:
    backgroundColor: "{colors.ghost}"
    textColor: "#fff"
`);
assert.equal(dangling.components[0].backgroundColor, undefined);
assert.equal(dangling.components[0].textColor, "#fff");

fs.rmSync(root, { force: true, recursive: true });
console.log("impeccable: ok");
