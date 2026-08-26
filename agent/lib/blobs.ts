/**
 * Attachment bytes, in MinIO.
 *
 * They used to travel as base64 inside the replay JSON, which meant a reopened chat carried
 * megabytes the browser could not cache and `replayEvents` dropped anything past a fixed budget —
 * silently, and that budget was smaller than one maximum-size upload. Here the bytes are stored
 * once and the transcript keeps only a key; `/api/attachments/<key>` serves them.
 *
 * The key is the sha256 of the content, so re-attaching the same screenshot costs nothing and the
 * object can be cached forever without an invalidation story.
 */
import { createHash } from "node:crypto";
import { Client } from "minio";

const BUCKET = process.env.MINIO_BUCKET ?? "becode-attachments";

/** A stored object's key: sha256 hex, and nothing else. Also the shape the route validates. */
export const KEY = /^[0-9a-f]{64}$/;

let client: Client | undefined;
let ready: Promise<void> | undefined;

/** Built on first use, not at import: the check harnesses import this tree with no MinIO running. */
function minio(): Client {
  client ??= new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "127.0.0.1",
    // Not MinIO's default 9000: becode shares a machine with other projects' buckets, and the
    // one that arrives last is the one that moves. `docker-compose.yml` publishes 9040.
    port: Number(process.env.MINIO_PORT ?? 9040),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY ?? "becode",
    secretKey: process.env.MINIO_SECRET_KEY ?? "becode-dev-secret",
  });
  return client;
}

/** ponytail: one bucket, made once per process. Nothing here needs prefixes or lifecycle rules. */
async function bucket(): Promise<Client> {
  const store = minio();
  ready ??= store.bucketExists(BUCKET).then(async (exists) => {
    if (!exists) await store.makeBucket(BUCKET);
  });
  try {
    await ready;
  } catch (e) {
    ready = undefined; // A failed connection must not poison every later upload.
    throw e;
  }
  return store;
}

/** Store bytes under their own hash and return the key. Storing twice is a no-op by construction. */
export async function putBlob(bytes: Buffer, mediaType: string): Promise<string> {
  const key = createHash("sha256").update(bytes).digest("hex");
  const store = await bucket();
  await store.putObject(BUCKET, key, bytes, bytes.length, { "Content-Type": mediaType });
  return key;
}

/** The bytes back, with the media type they were stored under. `undefined` when there is no such object. */
export async function getBlob(
  key: string,
): Promise<{ bytes: Buffer; mediaType: string } | undefined> {
  if (!KEY.test(key)) return undefined;
  const store = await bucket();
  const stat = await store.statObject(BUCKET, key).catch(() => undefined);
  if (!stat) return undefined;
  const stream = await store.getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return {
    bytes: Buffer.concat(chunks),
    mediaType: String(stat.metaData?.["content-type"] ?? "application/octet-stream"),
  };
}

/** What the person is told when the container is not up. The fix is one command, so name it. */
export const STORAGE_DOWN =
  "Attachment storage isn't running. Start it with `docker compose up -d` and send the file again.";

/** Where the browser fetches a stored attachment. The transcript keeps this, not the bytes. */
export const blobUrl = (key: string): string => `/api/attachments/${key}`;
