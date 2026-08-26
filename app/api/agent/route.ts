import { type Attachment, toBlocks } from "@/agent/lib/attachments.ts";
import { blobUrl, putBlob, STORAGE_DOWN } from "@/agent/lib/blobs.ts";
import { run, type TranscriptFile } from "@/agent/sdk/session.ts";
import { backfillEvents } from "@/agent/sdk/transcript.ts";

// The agent touches the host filesystem and spawns dev servers — it is not edge-compatible.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { message, sessionId, attachments, projectId, discoveryPath } = (await request.json()) as {
    message?: unknown;
    sessionId?: unknown;
    attachments?: unknown;
    projectId?: unknown;
    discoveryPath?: unknown;
  };

  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ message: "message is required" }, { status: 400 });
  }

  // The browser picks the files, so the allowlist is enforced here too, not only by `accept`.
  // A refusal is a 400 rather than an agent turn: nothing about a dropped video needs a model.
  const files = Array.isArray(attachments) ? (attachments as Attachment[]) : [];
  let blocks: ReturnType<typeof toBlocks>;
  try {
    blocks = toBlocks(files);
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 400 });
  }

  // Only after the allowlist has passed: a refused file never reaches storage. The bytes go to
  // MinIO once and the transcript keeps a URL, so reopening this chat costs a cached GET per
  // image instead of megabytes of base64 inside the replay body.
  let stored: TranscriptFile[];
  try {
    stored = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        mediaType: file.mediaType,
        src: blobUrl(await putBlob(Buffer.from(file.data, "base64"), file.mediaType)),
      })),
    );
  } catch {
    return Response.json({ message: STORAGE_DOWN }, { status: 503 });
  }

  // A chat older than the messages table gets its history copied in before this turn is appended
  // to it, or the read path would find one row and call that the whole conversation.
  const resumed = typeof sessionId === "string" ? sessionId : undefined;
  if (resumed) await backfillEvents(resumed).catch(() => undefined);

  const encoder = new TextEncoder();
  const events = run({
    message: message.trim(),
    attachments: blocks,
    files: stored,
    sessionId: resumed,
    projectId: typeof projectId === "string" ? projectId : undefined,
    discoveryPath: typeof discoveryPath === "string" ? discoveryPath : undefined,
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
