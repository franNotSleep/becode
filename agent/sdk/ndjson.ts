import type { AgentEvent } from "./session.ts";

/** One event per line, which is what the browser's reader in `use-becode-agent.ts` folds. */
export function ndjson(events: AsyncIterable<AgentEvent> | Iterable<AgentEvent>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
        controller.close();
      } catch {
        // The reader went away mid-write, or the subscription threw. Either way there is nobody
        // left to tell — and the turn itself is not this response's to stop.
        try {
          controller.close();
        } catch {
          // Already closed by the disconnect.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
