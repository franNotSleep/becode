/**
 * Content blocks → the events the browser renders.
 *
 * One walk, used twice: live, as the SDK streams a turn, and again when a chat is reopened from
 * the session store. Two walks would drift, and the second one is the one nobody watches.
 */
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "./session.ts";

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

/** How much attached base64 a reopened chat is allowed to carry back to the browser. */
const REPLAY_ATTACHMENT_BUDGET = 6 * 1024 * 1024;

/**
 * A stored session as the same event stream the browser already knows how to fold.
 *
 * The client reducer is reused verbatim, so a replayed tool row and a live one are the same
 * component fed the same shape.
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

    const files: { name: string; mediaType: string; data: string }[] = [];
    for (const block of blocks) {
      const source = block.source as { type?: string; media_type?: string; data?: string } | undefined;
      if (source?.type !== "base64" || typeof source.data !== "string") continue;
      // ponytail: drop the bytes past the budget rather than paginate — a chat with 25MB of
      // screenshots still opens, it just stops showing thumbnails partway down.
      if (source.data.length > budget) continue;
      budget -= source.data.length;
      files.push({
        name: String(block.title ?? (block.type === "image" ? "image" : "file")),
        mediaType: String(source.media_type ?? ""),
        data: source.data,
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
