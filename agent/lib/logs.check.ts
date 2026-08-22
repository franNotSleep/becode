/**
 * The log ring buffer: trimming, absolute offsets, and telling a reader it fell behind.
 *
 * node --experimental-strip-types agent/lib/logs.check.ts
 */
import assert from "node:assert/strict";
import { append, emptyBuffer, endOf, MAX_BYTES, since, tail } from "./logs.ts";

const buffer = emptyBuffer();
assert.equal(endOf(buffer), 0);
assert.deepEqual(since(buffer, 0), { text: "", to: 0, truncated: false });

// A reader picks up exactly what it has not seen, and nothing twice.
append(buffer, "Nest starting…\n");
const first = since(buffer, 0);
assert.equal(first.text, "Nest starting…\n");
append(buffer, "EADDRINUSE :3031\n");
const next = since(buffer, first.to);
assert.equal(next.text, "EADDRINUSE :3031\n", "only the new bytes come back");
assert.equal(next.to, endOf(buffer));
assert.equal(since(buffer, next.to).text, "", "a caught-up reader gets nothing");

// Past the cap, the front is trimmed and the offsets keep counting.
const big = emptyBuffer();
append(big, "x".repeat(MAX_BYTES));
append(big, "TAIL");
assert.equal(big.text.length, MAX_BYTES, "the buffer stays capped");
assert.equal(big.dropped, 4, "what was trimmed is counted, not forgotten");
assert.equal(endOf(big), MAX_BYTES + 4, "offsets are absolute, not buffer-relative");
assert.ok(big.text.endsWith("TAIL"));

// A cursor older than what is still held gets everything, and is told so.
const stale = since(big, 1);
assert.equal(stale.truncated, true);
assert.equal(stale.text, big.text);
assert.equal(stale.to, endOf(big));
// From zero on a trimmed buffer is a first read, not a reader that fell behind... except it is:
// bytes are genuinely missing either way, so it reports truncated only when it had a cursor.
assert.equal(since(big, 0).truncated, false);

assert.equal(tail(big, 4), "TAIL");
assert.equal(tail(buffer, 9999), buffer.text, "a tail longer than the buffer is the buffer");

console.log("logs: ok");
