/**
 * Object storage: a round trip, the content-addressing that makes it free to attach the same
 * screenshot twice, and the key validation that keeps a URL from reaching MinIO as a path.
 *
 * Needs the container. `docker compose up -d` first; without it this skips rather than fails,
 * so `npm run check:db` and friends stay runnable on a machine that has never started it.
 *
 * node --experimental-strip-types agent/lib/blobs.check.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getBlob, KEY, putBlob } from "./blobs.ts";

// A key is a sha256 and nothing else — this is what the route tests a URL segment against.
assert.ok(KEY.test("a".repeat(64)));
assert.ok(!KEY.test("../../etc/passwd"));
assert.ok(!KEY.test("A".repeat(64)), "hex is lowercase");
assert.ok(!KEY.test(`${"a".repeat(64)}.png`));
assert.equal(await getBlob("not-a-key"), undefined, "a bad key never reaches the bucket");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const up = await putBlob(png, "image/png").catch((e: Error) => e);
if (up instanceof Error) {
  console.log(`blobs: skipped — MinIO is not reachable (${up.message}). docker compose up -d`);
  process.exit(0);
}

assert.equal(up, createHash("sha256").update(png).digest("hex"), "the key is the content's hash");

const back = await getBlob(up);
assert.ok(back, "what went in comes back");
assert.deepEqual(back.bytes, png, "byte for byte");
assert.equal(back.mediaType, "image/png", "and still knows what it is");

// Attaching the same file to a second turn is one object, not two. This is why a stored URL can
// be cached forever: a key names exactly one sequence of bytes.
assert.equal(await putBlob(png, "image/png"), up);

// Different bytes, different key.
const other = Buffer.concat([png, Buffer.from([0])]);
assert.notEqual(await putBlob(other, "image/png"), up);

assert.equal(await getBlob("f".repeat(64)), undefined, "a key nothing was stored under is a miss");

console.log("blobs: ok");
