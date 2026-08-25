/**
 * The composer's slash token.
 *
 * Two failures matter. The tokens must cover the input exactly, or the overlay paints text the
 * textarea does not have and the two drift apart character by character. And only a *leading* token
 * may light up: a slash command one word in does not expand — verified against a live session — so
 * painting it would promise the person something that never happens.
 *
 * node --experimental-strip-types lib/skill-tokens.check.ts
 */
import assert from "node:assert/strict";
import { tokenize, typingSkill } from "./skill-tokens.ts";

const SKILLS = ["impeccable", "design-system-first"];
const parts = (text: string) => tokenize(text, SKILLS);
const rejoin = (text: string) => parts(text).map((t) => t.text).join("");
const painted = (text: string) => parts(text).filter((t) => t.skill).map((t) => t.text);

// Whatever else is true, the tokens must reassemble the input exactly.
for (const text of [
  "",
  "/impeccable",
  "/impeccable critique the hero",
  "make it bolder",
  "and/or is not a skill",
  "  /impeccable  ",
  "polish this /impeccable polish",
  "/unknown-skill /impeccable",
]) {
  assert.equal(rejoin(text), text, `tokens must cover: ${JSON.stringify(text)}`);
}

// Leading, with and without arguments, bare or plugin-qualified.
assert.deepEqual(painted("/impeccable"), ["/impeccable"]);
assert.deepEqual(painted("/impeccable critique the hero"), ["/impeccable"]);
assert.deepEqual(painted("  /design-system-first match the cards"), ["/design-system-first"]);
assert.deepEqual(painted("/becode:impeccable audit"), ["/becode:impeccable"]);

// Not leading: the CLI treats these as ordinary words, so they must not look like commands.
assert.deepEqual(painted("polish this /impeccable polish"), []);
assert.deepEqual(painted("please /impeccable critique"), []);
assert.deepEqual(painted("/unknown-skill /impeccable"), []);

// Only real skills light up — a typo must look like a typo.
assert.deepEqual(painted("/impecable critique"), []);
assert.deepEqual(painted("/usage"), []);
assert.deepEqual(painted("and/or"), []);
assert.deepEqual(painted("src/impeccable"), []);

// The menu opens on a leading slash and closes once the token is finished.
assert.equal(typingSkill("/", 1), "");
assert.equal(typingSkill("/imp", 4), "imp");
assert.equal(typingSkill("  /des", 6), "des");
assert.equal(typingSkill("/impeccable ", 12), null);
assert.equal(typingSkill("make it /des", 12), null);
assert.equal(typingSkill("and/or", 6), null);
assert.equal(typingSkill("nothing here", 12), null);
// The caret is what matters, not the end of the text.
assert.equal(typingSkill("/imp critique", 4), "imp");

console.log("skill-tokens: ok");
