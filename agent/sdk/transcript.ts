/**
 * Content blocks → the events the browser renders.
 *
 * One walk, used twice: live, as the SDK streams a turn, and again when a chat is reopened from
 * the session store. Two walks would drift, and the second one is the one nobody watches.
 */
import { getSessionMessages, type SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { appendEvents, loadEvents } from "../lib/db.ts";
import type { AgentEvent, TranscriptFile } from "./session.ts";

/**
 * Harness plumbing, not work. `ToolSearch` loads deferred tool schemas; it never reaches
 * `canUseTool` because it cannot execute anything, and what it loads is still gated. Showing it
 * to a non-engineer is noise.
 */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

type Block = Record<string, unknown>;

const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : []);

/** Text, thinking and tool calls. `hidden` collects the ids whose results to drop as well. */
export function assistantEvents(content: unknown, hidden: Set<string>): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of blocksOf(content)) {
    if (block.type === "text" && String(block.text ?? "").trim()) {
      events.push({ type: "delta", text: String(block.text) });
    } else if (block.type === "thinking" && String(block.thinking ?? "").trim()) {
      events.push({ type: "reasoning", text: String(block.thinking) });
    } else if (block.type === "tool_use") {
      if (HIDDEN_TOOLS.has(String(block.name))) {
        hidden.add(String(block.id));
        continue;
      }
      events.push({
        type: "tool",
        id: String(block.id),
        name: String(block.name),
        title: summarize(String(block.name), block.input),
        input: block.input,
      });
    }
  }
  return events;
}

/** The tool_result blocks the CLI sends back as a user-role message. */
export function toolResultEvents(content: unknown, hidden: Set<string>): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const block of blocksOf(content)) {
    if (block.type !== "tool_result" || hidden.has(String(block.tool_use_id))) continue;
    events.push({
      type: "tool-result",
      id: String(block.tool_use_id),
      ok: block.is_error !== true,
      text: flatten(block.content).slice(0, 2000),
    });
  }
  return events;
}

/**
 * How much attached base64 a reopened chat is allowed to carry back to the browser.
 *
 * Legacy chats only. Everything becode records now keeps attachments in object storage and the
 * transcript keeps a URL, so there is no budget to run out of — but a chat from before that has
 * nothing except the base64 in the SDK's transcript, and this is the ceiling on carrying it.
 */
const REPLAY_ATTACHMENT_BUDGET = 6 * 1024 * 1024;

/**
 * A stored session as the same event stream the browser already knows how to fold.
 *
 * The client reducer is reused verbatim, so a replayed tool row and a live one are the same
 * component fed the same shape.
 *
 * The fallback path: only chats recorded before becode kept its own `messages` table reach this,
 * and their attachments exist nowhere but the base64 here. `app/api/sessions/[id]` prefers the
 * table, where an image is a URL.
 */
export function replayEvents(messages: SessionMessage[]): AgentEvent[] {
  const events: AgentEvent[] = [];
  const hidden = new Set<string>();
  let budget = REPLAY_ATTACHMENT_BUDGET;

  for (const entry of messages) {
    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (!message || entry.type === "system") continue;

    if (entry.type === "assistant") {
      events.push(...assistantEvents(message.content, hidden));
      continue;
    }

    // A user-role message is either the person's turn or the CLI answering a tool call.
    const blocks = blocksOf(message.content);
    if (blocks.some((b) => b.type === "tool_result")) {
      events.push(...toolResultEvents(message.content, hidden));
      continue;
    }

    const text =
      typeof message.content === "string"
        ? message.content
        : blocks
            .filter((b) => b.type === "text")
            .map((b) => String(b.text ?? ""))
            .join("\n");

    const files: TranscriptFile[] = [];
    for (const block of blocks) {
      const source = block.source as { type?: string; media_type?: string; data?: string } | undefined;
      if (source?.type !== "base64" || typeof source.data !== "string") continue;
      // ponytail: drop the bytes past the budget rather than paginate — a chat with 25MB of
      // screenshots still opens, it just stops showing thumbnails partway down.
      if (source.data.length > budget) continue;
      budget -= source.data.length;
      const mediaType = String(source.media_type ?? "");
      files.push({
        // An image block has no `title` — Anthropic's shape has nowhere to put one, so a legacy
        // image cannot get its filename back. Chats recorded since keep the real name.
        name: String(block.title ?? (block.type === "image" ? "image" : "file")),
        mediaType,
        src: `data:${mediaType};base64,${source.data}`,
      });
    }

    if (!text.trim() && files.length === 0) continue;
    events.push({ type: "user", text: text.trim(), files });
  }

  return events;
}

/** A tool row reads better titled by what it acted on than by the tool's own name. */
export function summarize(name: string, input: unknown): string {
  const tool = name.replace(/^mcp__becode__/, "");
  if (input === null || typeof input !== "object") return tool;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "pattern", "path", "projectId", "title", "request"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return `${tool} ${value.split("/").slice(-2).join("/")}`;
    }
  }
  return tool;
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block && "text" in block ? String(block.text) : ""))
      .join("");
  }
  return "";
}

/**
 * Give a chat that predates the `messages` table its history, once, before it says anything else.
 *
 * Without this, resuming an old chat would start its table at the current turn and everything
 * before it would sit unreachable in the SDK's transcript — the read path prefers the table as
 * soon as it holds a single row. Runs at most once per chat: the second call sees rows.
 *
 * Legacy attachments come across as `data:` URLs, budget and all. The bytes exist nowhere else,
 * so this is as good as those images get; anything attached from here on goes to object storage.
 */
export async function backfillEvents(sessionId: string): Promise<void> {
  if (loadEvents(sessionId).length > 0) return;
  const messages = await getSessionMessages(sessionId).catch(() => null);
  if (messages?.length) appendEvents(sessionId, replayEvents(messages));
}
