import { type Attachment, toBlocks } from "@/agent/lib/attachments.ts";
import { run } from "@/agent/sdk/session.ts";

// The agent touches the host filesystem and spawns dev servers — it is not edge-compatible.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { message, sessionId, attachments, projectId } = (await request.json()) as {
    message?: unknown;
    sessionId?: unknown;
    attachments?: unknown;
    projectId?: unknown;
  };

  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ message: "message is required" }, { status: 400 });
  }

  // The browser picks the files, so the allowlist is enforced here too, not only by `accept`.
  // A refusal is a 400 rather than an agent turn: nothing about a dropped video needs a model.
  let blocks: ReturnType<typeof toBlocks>;
  try {
    blocks = toBlocks(Array.isArray(attachments) ? (attachments as Attachment[]) : []);
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const events = run({
    message: message.trim(),
    attachments: blocks,
    sessionId: typeof sessionId === "string" ? sessionId : undefined,
    projectId: typeof projectId === "string" ? projectId : undefined,
    signal: request.signal,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "The agent stopped unexpectedly.";
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message })}\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
