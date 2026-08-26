import { getBlob, KEY } from "@/agent/lib/blobs.ts";

export const runtime = "nodejs";

type Context = { params: Promise<{ key: string }> };

/**
 * One attachment's bytes.
 *
 * The key arrives from the URL, so it is checked here before it reaches MinIO — it is a sha256 of
 * the content or it is nothing. That is also why the response can be cached forever: a key names
 * exactly one sequence of bytes, so there is no invalidation to get wrong.
 */
export async function GET(_request: Request, { params }: Context) {
  const { key } = await params;
  if (!KEY.test(key)) return new Response("Not found", { status: 404 });

  const blob = await getBlob(key).catch(() => undefined);
  if (!blob) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(blob.bytes), {
    headers: {
      "Content-Type": blob.mediaType,
      "Content-Length": String(blob.bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
