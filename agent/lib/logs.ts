/**
 * What a dev server said, kept long enough to be useful.
 *
 * The old buffer was forty chunks with `shift()` — for a Nest server booting, seconds. Whatever
 * killed it was evicted before anyone could look. This keeps a fixed number of bytes and, more
 * importantly, hands out an **absolute** offset so a reader can ask for only what it has not seen
 * and can tell when it fell behind.
 */

/** `dropped` is how many bytes have been trimmed off the front, so offsets never restart. */
export type LogBuffer = { text: string; dropped: number };

/** Roughly a few thousand lines of dev-server output. Bytes, not lines: a stack trace is one line. */
export const MAX_BYTES = 256 * 1024;

export const emptyBuffer = (): LogBuffer => ({ text: "", dropped: 0 });

/** The end of the buffer, in absolute bytes. This is the cursor a reader carries. */
export const endOf = (buffer: LogBuffer): number => buffer.dropped + buffer.text.length;

export function append(buffer: LogBuffer, chunk: string): void {
  buffer.text += chunk;
  const excess = buffer.text.length - MAX_BYTES;
  if (excess > 0) {
    buffer.text = buffer.text.slice(excess);
    buffer.dropped += excess;
  }
}

/**
 * Everything after `from`.
 *
 * A cursor older than what is still held cannot be honoured, so the whole buffer comes back with
 * `truncated` rather than a slice starting mid-line that reads as if nothing were missing.
 */
export function since(
  buffer: LogBuffer,
  from: number,
): { text: string; to: number; truncated: boolean } {
  const to = endOf(buffer);
  if (from < buffer.dropped) return { text: buffer.text, to, truncated: from > 0 };
  return { text: buffer.text.slice(from - buffer.dropped), to, truncated: false };
}

/** The last `bytes` of output — what a person or the model actually reads first. */
export function tail(buffer: LogBuffer, bytes: number): string {
  return buffer.text.length <= bytes ? buffer.text : buffer.text.slice(-bytes);
}
