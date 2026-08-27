/**
 * A turn in flight, and who happens to be watching it.
 *
 * A turn used to be the HTTP request. `run()` was driven by the `for await` inside the response
 * stream and aborted on `request.signal`, so anything that ended the fetch — the Stop button, but
 * equally clicking another chat, reloading, or closing the tab — tore the agent down wherever it
 * had got to. Mid-`Edit` that surfaced as `Tool permission request failed: AbortError: Stream
 * closed`: the CLI had asked becode for permission and the pipe closed before the answer came
 * back, leaving a half-applied change in a worktree and no way to reach the rest of the turn.
 *
 * So the turn is owned here instead, and a browser is a *subscriber*. Disconnecting drops the
 * subscriber. Stopping is now an explicit act (`POST /api/agent/stop`), which is what the Stop
 * button meant all along, and reopening the chat picks the same turn back up mid-flight.
 *
 * The cursor is the `messages` row id (`agent/lib/db.ts`), the same absolute-cursor arrangement
 * as the log ring buffer: a reader says what it has, and gets what came after. Events emitted
 * before the init message has reported a session id carry `-1` — there is no row for them yet,
 * and nobody can reattach to a chat that has no id to reattach by. They reach the browser on the
 * live subscription like everything else, and land in the table when the id arrives.
 */
import type { AgentEvent } from "./session.ts";
import { run, type RunInput } from "./session.ts";

export type Turn = {
  entries: { id: number; event: AgentEvent }[];
  done: boolean;
  controller: AbortController;
  /** Resolved and replaced on every append, so a follower can wait without missing one. */
  next: { promise: Promise<void>; wake: () => void };
};

/**
 * Every turn this process has run, by session id.
 *
 * ponytail: no eviction. A finished turn is replaced by the chat's next one and holds only that
 * turn's events (attachments are URLs, not bytes), so this grows with chats used since the last
 * restart. An LRU is the upgrade path if a becode ever runs for weeks.
 */
const turns = new Map<string, Turn>();

export const liveTurn = (key: string): Turn | undefined => turns.get(key);

/** Whether a turn is still producing — the one thing a second POST must not start over. */
export const isRunning = (key: string): boolean => {
  const turn = turns.get(key);
  return !!turn && !turn.done;
};

export function newTurn(): Turn {
  const turn: Turn = {
    entries: [],
    done: false,
    controller: new AbortController(),
    next: { promise: Promise.resolve(), wake: () => undefined },
  };
  arm(turn);
  return turn;
}

function arm(turn: Turn) {
  let wake: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    wake = resolve;
  });
  turn.next = { promise, wake };
}

export function append(turn: Turn, event: AgentEvent, id: number) {
  turn.entries.push({ id, event });
  const { wake } = turn.next;
  arm(turn);
  wake();
}

export function finish(turn: Turn) {
  turn.done = true;
  const { wake } = turn.next;
  arm(turn);
  wake();
}

/**
 * Everything after `after` — or everything, with no cursor — then whatever follows, until the
 * turn ends.
 *
 * The wait is taken *before* the entries are drained. The other order loses any event appended
 * between the drain and the wait — which is the one that matters, because it is the event the
 * turn was busy producing while the browser was reconnecting.
 */
export async function* follow(turn: Turn, after?: number): AsyncGenerator<AgentEvent> {
  let read = 0;
  while (true) {
    const wait = turn.next.promise;
    while (read < turn.entries.length) {
      const entry = turn.entries[read++];
      // No cursor is the subscriber that started the turn: it wants all of it, including the
      // events emitted before there was a row to number them by.
      if (after === undefined || entry.id > after) yield entry.event;
    }
    if (turn.done) return;
    await wait;
  }
}

/**
 * Start a turn and register it. The caller subscribes; it does not own the run.
 *
 * Registered under the session id as soon as the init message reports one — a new chat has none
 * when this is called, so it is keyed by the temporary id the browser sent until then. Both keys
 * stay, exactly as `rememberChat` keeps a `Chat` under every id it ever reported.
 */
export function startTurn(key: string, input: Omit<RunInput, "signal" | "sink">): Turn {
  const turn = newTurn();
  turns.set(key, turn);

  void run({
    ...input,
    signal: turn.controller.signal,
    sink: (event, id) => {
      if (event.type === "session") turns.set(event.sessionId, turn);
      append(turn, event, id);
    },
  })
    // `run` handles its own failures; this is the one that would otherwise be an unhandled
    // rejection with nobody left to tell.
    .catch(() => undefined)
    .finally(() => finish(turn));

  return turn;
}
