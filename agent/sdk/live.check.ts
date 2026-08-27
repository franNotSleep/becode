/**
 * A turn nobody is watching, and a browser that comes back to it.
 *
 * The failure this exists for: the turn used to be the HTTP request, so closing the tab — or
 * clicking another chat — aborted the agent mid-`Edit` and the CLI reported
 * `Tool permission request failed: AbortError: Stream closed`. A turn now outlives its
 * subscribers, which is only true if two things hold: a late follower gets the backlog, and
 * nothing appended while a follower is between events is lost.
 *
 * node --experimental-strip-types agent/sdk/live.check.ts
 */
import assert from "node:assert/strict";
import { append, finish, follow, newTurn } from "./live.ts";
import type { AgentEvent } from "./session.ts";

const text = (n: number) => ({ type: "delta" as const, text: String(n) });
const drain = async (events: AsyncGenerator<AgentEvent>) => {
  const seen: string[] = [];
  for await (const event of events) seen.push(event.type === "delta" ? event.text : event.type);
  return seen;
};

// A follower from the start gets everything, including the events emitted before the init message
// reported a session id — those have no row to be numbered by yet, so they carry -1.
{
  const turn = newTurn();
  append(turn, text(1), -1);
  append(turn, text(2), 7);
  finish(turn);
  assert.deepEqual(await drain(follow(turn)), ["1", "2"]);
}

// A browser reattaching says what it already read. It has the stored history, so -1 and anything
// at or before the cursor must not arrive twice.
{
  const turn = newTurn();
  append(turn, text(1), -1);
  append(turn, text(2), 7);
  append(turn, text(3), 8);
  finish(turn);
  assert.deepEqual(await drain(follow(turn, 7)), ["3"]);
  assert.deepEqual(await drain(follow(turn, 8)), [], "caught up is an empty stream, not a wait");
}

// The turn keeps producing with nobody watching, and the follower that shows up later gets all of
// it — this is the whole point: the run does not belong to a connection.
{
  const turn = newTurn();
  append(turn, text(1), 1);
  const seen = drain(follow(turn, 0));
  append(turn, text(2), 2);
  await new Promise((r) => setImmediate(r));
  append(turn, text(3), 3);
  finish(turn);
  assert.deepEqual(await seen, ["1", "2", "3"]);
}

// The race the wait ordering exists for: appended while the follower is suspended *inside* a
// yield, between draining and waiting. Taking the wait before the drain is what makes it arrive.
{
  const turn = newTurn();
  append(turn, text(1), 1);
  const events = follow(turn, 0);
  const first = await events.next();
  assert.equal(first.value && "text" in first.value ? first.value.text : undefined, "1");
  append(turn, text(2), 2);
  append(turn, text(3), 3);
  finish(turn);
  assert.deepEqual(await drain(events), ["2", "3"]);
}

// Two watchers of one turn — a second tab, or a reattach that overlaps the first.
{
  const turn = newTurn();
  const a = drain(follow(turn));
  const b = drain(follow(turn));
  append(turn, text(1), 1);
  finish(turn);
  assert.deepEqual(await a, ["1"]);
  assert.deepEqual(await b, ["1"]);
}

console.log("live: a turn outlives its subscribers");
