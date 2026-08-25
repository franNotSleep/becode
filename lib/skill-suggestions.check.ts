/**
 * The chips, driven directly.
 *
 * The failure that matters is a silent one: a table edit that stops matching, or a rank that puts
 * the wrong chip first. Both look fine on screen and route the agent wrong.
 *
 * node --experimental-strip-types lib/skill-suggestions.check.ts
 */
import assert from "node:assert/strict";
import { suggest } from "./skill-suggestions.ts";

const ids = (draft: string) => suggest(draft).map((s) => s.id);

// A word is not a request yet — chips that swap under the person's hands are worse than none.
assert.deepEqual(ids("cramped"), []);
assert.deepEqual(ids(""), []);

// Enough said to mean something.
assert.deepEqual(ids("the pricing page feels cramped and hard to read"), ["critique"]);
assert.ok(ids("it looks bland on mobile").includes("audit"));
assert.ok(ids("it looks bland on mobile").includes("bolder"));

// More hits ranks higher: two "quieter" words beat one "animate" word.
assert.equal(ids("this hero is loud and overwhelming, and the hover moves too")[0], "quieter");

// Three at most, however many match.
assert.ok(
  suggest("bland boring flat generic cramped busy mobile contrast polish tidy animate motion")
    .length <= 3,
);

// Nothing to say about a request that is not about how it looks.
assert.deepEqual(ids("change the checkout total to include tax"), []);

console.log("suggestions: ok");
