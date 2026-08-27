import { follow, liveTurn } from "@/agent/sdk/live.ts";
import { ndjson } from "@/agent/sdk/ndjson.ts";

export const runtime = "nodejs";

/**
 * Reattach to a turn that is still running.
 *
 * The browser is a subscriber, not the owner (`agent/sdk/live.ts`), so reopening a chat mid-turn
 * picks the same turn back up. `after` is the last `messages` row the caller already has —
 * `GET /api/sessions/[id]` hands it back with the history — so nothing arrives twice and nothing
 * produced between the two requests is missed.
 *
 * Nothing live is the ordinary case, not an error: the stream just ends, and the chat the caller
 * has already loaded is the whole story.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const after = Number(url.searchParams.get("after") ?? 0);
  const turn = sessionId ? liveTurn(sessionId) : undefined;

  return ndjson(turn && !turn.done ? follow(turn, Number.isFinite(after) ? after : 0) : []);
}
