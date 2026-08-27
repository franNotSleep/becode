import { liveTurn } from "@/agent/sdk/live.ts";

export const runtime = "nodejs";

/**
 * Stop a running turn, on purpose.
 *
 * This is the only thing that aborts a run now. It used to be `request.signal` on the streaming
 * response, which meant a closed tab or a click on another chat stopped the agent mid-`Edit` —
 * see the note at the top of `agent/sdk/live.ts`.
 */
export async function POST(request: Request) {
  const { key } = (await request.json()) as { key?: unknown };
  const turn = typeof key === "string" ? liveTurn(key) : undefined;
  turn?.controller.abort();
  return Response.json({ stopped: !!turn && !turn.done });
}
