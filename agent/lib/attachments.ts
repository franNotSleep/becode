/**
 * What the person can hand becode besides words, and what it becomes.
 *
 * An attachment never lands on disk. It travels as Messages API content blocks straight into the
 * turn, so the worktree read boundary in `resolveInWorktree` does not have to widen — and there is
 * no worktree yet on the turn that calls `start_task` anyway.
 *
 * This is a trust boundary: the browser picks the files, so the allowlist and the caps are
 * enforced here, on the server, not only by the `accept` attribute on the input.
 */
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

/** One file, as the browser sends it. `data` is base64, no data: prefix. */
export type Attachment = { name: string; mediaType: string; data: string };

/** An allowlist, not a video denylist: everything not named here is refused. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_EXTENSIONS = new Set([
  ".css", ".csv", ".html", ".js", ".json", ".jsx", ".md", ".mdx",
  ".scss", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);

export const MAX_FILES = 5;
/** Anthropic's per-image limit; applied to every kind so one file cannot dominate the request. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

/** The `accept` attribute for the file input — the same allowlist the server enforces. */
export const ACCEPT = [...IMAGE_TYPES, "application/pdf", ...TEXT_EXTENSIONS].join(",");

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

/** Cheap enough for a paste handler: browsers know the type and the name before reading bytes. */
export function isAllowed(name: string, mediaType: string): boolean {
  return (
    IMAGE_TYPES.has(mediaType) ||
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/") ||
    TEXT_EXTENSIONS.has(extensionOf(name))
  );
}

/** Decoded length of a base64 string, without allocating it. Works in both runtimes. */
function byteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** `Buffer` would pull a Node polyfill into the client bundle; these two are global in both. */
const decodeText = (base64: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

/**
 * Validate and convert. Throws on anything refused — the caller turns that into a 400, so a
 * dropped video fails as a plain message rather than as an agent turn.
 */
export function toBlocks(attachments: Attachment[]): ContentBlockParam[] {
  if (attachments.length === 0) return [];
  if (attachments.length > MAX_FILES) {
    throw new Error(`Too many attachments: ${attachments.length}. The limit is ${MAX_FILES}.`);
  }

  let total = 0;
  return attachments.map(({ name, mediaType, data }) => {
    const size = byteLength(data);
    total += size;
    if (size > MAX_FILE_BYTES) {
      throw new Error(`${name} is ${mb(size)}MB. The limit is ${mb(MAX_FILE_BYTES)}MB per file.`);
    }
    if (total > MAX_TOTAL_BYTES) {
      throw new Error(`Those attachments come to more than ${mb(MAX_TOTAL_BYTES)}MB in total.`);
    }

    if (IMAGE_TYPES.has(mediaType)) {
      return {
        type: "image",
        source: { type: "base64", media_type: mediaType as "image/png", data },
      };
    }
    if (mediaType === "application/pdf") {
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
        title: name,
      };
    }
    if (mediaType.startsWith("text/") || TEXT_EXTENSIONS.has(extensionOf(name))) {
      return { type: "text", text: `Attached file \`${name}\`:\n\n\`\`\`\n${decodeText(data)}\n\`\`\`` };
    }
    throw new Error(`${name} (${mediaType || "unknown type"}) is not a kind of file becode accepts.`);
  });
}

/**
 * The current turn's blocks.
 *
 * Gate 1 rules on what `start_task` was asked for, and the ask may live inside the screenshot
 * rather than the typed text. The judge runs deep inside a tool call, so it reads the turn from
 * here rather than having the blocks threaded through `tool()`.
 *
 * ponytail: a module singleton, like `task` next door — one process, one person, one turn at a
 * time. Per-session state is the upgrade if becode ever serves two people at once.
 */
let turn: ContentBlockParam[] = [];

export const turnAttachments = {
  get: (): ContentBlockParam[] => turn,
  set: (blocks: ContentBlockParam[]) => {
    turn = blocks;
  },
};

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
