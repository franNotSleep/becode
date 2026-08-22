/**
 * The attachment allowlist and its caps — the one place a browser-supplied file is refused.
 *
 * node --experimental-strip-types agent/lib/attachments.check.ts
 */
import assert from "node:assert/strict";
import {
  type Attachment,
  ACCEPT,
  isAllowed,
  MAX_FILE_BYTES,
  toBlocks,
} from "./attachments.ts";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const png = (bytes: number): Attachment => ({
  name: "shot.png",
  mediaType: "image/png",
  data: "A".repeat(Math.ceil((bytes * 4) / 3)),
});

assert.deepEqual(toBlocks([]), []);

// An image becomes an image block, base64 passed through untouched.
assert.deepEqual(toBlocks([{ name: "shot.png", mediaType: "image/png", data: "abcd" }]), [
  { type: "image", source: { type: "base64", media_type: "image/png", data: "abcd" } },
]);

// A PDF becomes a document block and keeps its name, so the model can refer to it.
assert.deepEqual(toBlocks([{ name: "spec.pdf", mediaType: "application/pdf", data: "abcd" }]), [
  { type: "document", source: { type: "base64", media_type: "application/pdf", data: "abcd" }, title: "spec.pdf" },
]);

// Text and code are inlined, decoded, fenced. Typed as text/plain or recognised by extension.
const [inlined] = toBlocks([{ name: "copy.md", mediaType: "", data: b64("# Hello") }]);
assert.equal(inlined.type, "text");
assert.match((inlined as { text: string }).text, /copy\.md[\s\S]*# Hello/);

// Video is refused, which is the whole point of an allowlist rather than a denylist.
assert.throws(() => toBlocks([{ name: "clip.mp4", mediaType: "video/mp4", data: "abcd" }]), /not a kind of file/);
assert.throws(() => toBlocks([{ name: "app.exe", mediaType: "application/octet-stream", data: "abcd" }]), /not a kind of file/);

// Caps: per file, and across the turn.
assert.throws(() => toBlocks([png(MAX_FILE_BYTES + 1024)]), /per file/);
assert.throws(() => toBlocks(Array.from({ length: 6 }, () => png(16))), /Too many attachments/);
assert.throws(() => toBlocks(Array.from({ length: 4 }, () => png(4.5 * 1024 * 1024))), /in total/);

// The browser-side filter agrees with the server-side one.
assert.equal(isAllowed("shot.png", "image/png"), true);
assert.equal(isAllowed("notes.ts", ""), true);
assert.equal(isAllowed("clip.mp4", "video/mp4"), false);
assert.ok(ACCEPT.includes("image/png") && ACCEPT.includes(".ts") && !ACCEPT.includes("video"));

console.log("attachments: ok");
