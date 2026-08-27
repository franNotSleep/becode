/**
 * Which Linear team an issue is filed against.
 *
 * The failure this exists for already happened: the workspace grew a second team, `nodes[0]`
 * kept returning the other one, and every becode PR landed under `AIR-…` — in the branch name,
 * which is the whole link. Guessing is now only allowed when there is nothing to guess between.
 *
 * node --experimental-strip-types agent/lib/linear.check.ts
 */
import assert from "node:assert/strict";
import { pickTeam } from "./linear.ts";

const TWO = [{ key: "AIR" }, { key: "TIX" }];

// The project's choice wins, wherever Linear happens to list it.
assert.deepEqual(pickTeam(TWO, "TIX"), { key: "TIX" });
assert.deepEqual(pickTeam(TWO, "AIR"), { key: "AIR" });

// One team is not a guess. No teams, and a key the token cannot see, are both refusals — and the
// refusal is what the person reads, so it has to name the fix.
assert.deepEqual(pickTeam([{ key: "TIX" }]), { key: "TIX" });
assert.throws(() => pickTeam([]), /can see no teams/);
assert.throws(() => pickTeam(TWO, "NOPE"), /sees no team "NOPE"/);

// The one that used to pass silently: unset, more than one team, no filing.
assert.throws(() => pickTeam(TWO), /more than one team \(AIR, TIX\)/);

console.log("linear: team choice ok");
