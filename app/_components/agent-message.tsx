"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { CircleAlertIcon, FileTextIcon } from "lucide-react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import {
  AgentActivity,
  type AgentActivityItem,
  type AgentTraceKind,
} from "@/components/agents/agent-activity";
import { type CitationItem, Citations } from "@/components/agents/citations";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "@/components/agents/message";
import { ToolApproval } from "@/components/agents/tool-approval";
import { dataUrl } from "./agent-chat";
import { ImpeccableSetup, impeccableState } from "./impeccable-setup";
import type { BecodeMessage, BecodePart } from "./use-becode-agent";

type OnRespond = (id: string, approved: boolean) => void | Promise<void>;

// beUI's Message is a layout primitive, so markdown stays on streamdown.
const streamdownPlugins = { cjk, code, math, mermaid };

const Markdown = memo(({ children }: { readonly children: string }) => (
  <Streamdown
    className="[&_pre]:my-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    plugins={streamdownPlugins}
  >
    {children}
  </Streamdown>
));
Markdown.displayName = "Markdown";

export function AgentMessage({
  canRespond,
  live = false,
  message,
  onRespond,
}: {
  readonly canRespond: boolean;
  /** This is the turn still streaming — its trailing activity shimmers instead of collapsing. */
  readonly live?: boolean;
  readonly message: BecodeMessage;
  readonly onRespond: OnRespond;
}) {
  // What the CEO typed reads as something they said: a bubble on their side. What becode says is
  // the document — full width, no container, so a diff or a URL is not squeezed into a chat bubble.
  if (message.role === "user") {
    const files = message.parts.filter((part) => part.type === "file");
    return (
      <Message animateIn from="user">
        <MessageContent>
          <MessageBubble animateIn variant="soft">
            <MessageBubbleContent>
              {files.length > 0 ? (
                <span className="mb-2 flex flex-wrap gap-2">
                  {files.map((file, index) =>
                    file.mediaType.startsWith("image/") ? (
                      // biome-ignore lint/performance/noImgElement: a data: URL has nothing to optimise.
                      <img
                        alt={file.name}
                        className="max-h-40 rounded-lg border border-border/60 object-cover"
                        key={`${file.name}:${index}`}
                        src={dataUrl(file)}
                      />
                    ) : (
                      <span
                        className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1 text-xs"
                        key={`${file.name}:${index}`}
                      >
                        <FileTextIcon className="size-3.5" />
                        {file.name}
                      </span>
                    ),
                  )}
                </span>
              ) : null}
              {plainText(message)}
            </MessageBubbleContent>
          </MessageBubble>
        </MessageContent>
      </Message>
    );
  }

  const blocks = group(message.parts);

  return (
    <Message animateIn from="assistant">
      <MessageContent className="space-y-3">
        {blocks.map((block, index) =>
          block.kind === "activity" ? (
            <Activity
              key={`activity:${block.parts[0]?.type}:${index}`}
              live={live && index === blocks.length - 1}
              parts={block.parts}
            />
          ) : (
            <AgentMessagePart
              canRespond={canRespond}
              key={partKey(block.part, index)}
              onRespond={onRespond}
              part={block.part}
            />
          ),
        )}
      </MessageContent>
    </Message>
  );
}

/**
 * The issue and the pull request a shipped change produced, read back off the tool row.
 *
 * Derived from the transcript the client already holds rather than a new event: a reopened chat
 * replays `open_pull_request` through the same reducer, so this renders there too with no second
 * read path. The output is JSON becode wrote itself, but it arrives here as a truncated string
 * (transcript.ts caps tool results at 2000 chars), so a parse failure is normal — not an error.
 *
 * The tool name is spelled out rather than imported from `TOOL` in agent/sdk/tools.ts, for the
 * same reason `shippable` in agent-chat.tsx spells it out: that module spawns processes.
 */
function shippedLinks(name: string, output?: string): CitationItem[] {
  if (name !== "mcp__becode__open_pull_request" || !output) return [];

  let result: { url?: string; issue?: string; issueUrl?: string };
  try {
    result = JSON.parse(output);
  } catch {
    return [];
  }

  const items: CitationItem[] = [];
  if (result.issue && result.issueUrl) {
    items.push({ id: "issue", title: result.issue, domain: "linear.app", url: result.issueUrl });
  }
  if (result.url) {
    items.push({ id: "pr", title: "Pull request", domain: "github.com", url: result.url });
  }
  return items;
}

function plainText(message: BecodeMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

/**
 * Consecutive thinking, narration and tool calls, folded into one run.
 *
 * A run is what the person watches: "reading the theme file, editing the card, opening the PR",
 * one collapsible block rather than a stack of cards. Only the message's *last* text part stays
 * outside — that is the answer, and the answer is the document.
 */
type Block =
  | { kind: "activity"; parts: BecodePart[] }
  | { kind: "part"; part: BecodePart };

function group(parts: BecodePart[]): Block[] {
  const blocks: Block[] = [];
  for (const [index, part] of parts.entries()) {
    const activity =
      part.type === "tool" ||
      part.type === "reasoning" ||
      (part.type === "text" && index < parts.length - 1);
    const open = blocks.at(-1);
    if (!activity) blocks.push({ kind: "part", part });
    else if (open?.kind === "activity") open.parts.push(part);
    else blocks.push({ kind: "activity", parts: [part] });
  }
  return blocks;
}

/** Built-in tools by what they do to the worktree; becode's own tools all read as actions. */
const TOOL_KIND: Record<string, AgentTraceKind> = {
  Edit: "write",
  Glob: "read",
  Grep: "read",
  Read: "read",
  Write: "write",
};

function Activity({ live, parts }: { readonly live: boolean; readonly parts: BecodePart[] }) {
  const items: AgentActivityItem[] = parts.map((part, index) =>
    part.type === "tool"
      ? {
          detail: detailOf(part.name, part.title),
          icon:
            part.state === "error" ? (
              <CircleAlertIcon className="size-4 text-rose-500" />
            ) : undefined,
          id: part.id,
          kind: TOOL_KIND[part.name] ?? "run",
          label: labelOf(part.name),
          type: "trace",
        }
      : {
          content: part.type === "text" || part.type === "reasoning" ? part.text : "",
          id: `note:${index}`,
          type: "text",
        },
  );

  // Cards the run produced. Derived from the tool rows, exactly as before — they carry links and
  // a next step, so they belong under the run rather than inside a collapsed disclosure.
  const cards = parts.flatMap((part, index) => {
    if (part.type !== "tool" || part.state !== "success") return [];
    const shipped = shippedLinks(part.name, part.output);
    const impeccable = impeccableState(part.name, part.output);
    return [
      shipped.length > 0 ? (
        <Citations
          citations={shipped}
          defaultOpen
          key={`shipped:${index}`}
          title="Where this change went"
        />
      ) : null,
      impeccable ? <ImpeccableSetup key={`impeccable:${index}`} state={impeccable} /> : null,
    ].filter(Boolean);
  });

  const tools = parts.filter((part) => part.type === "tool").length;
  const notes = parts.length - tools;

  return (
    <>
      <AgentActivity
        activeLabel={activeLabel(parts)}
        items={items}
        status={live ? "working" : "complete"}
        summary={summaryOf(tools, notes)}
      />
      {cards}
    </>
  );
}

/** `mcp__becode__open_pull_request` reads as "Open pull request"; `Read` stays `Read`. */
function labelOf(name: string): string {
  const tool = name.replace(/^mcp__becode__/, "");
  if (!tool.includes("_")) return tool;
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `summarize` in transcript.ts already put the target in the title, behind the tool's own name. */
function detailOf(name: string, title: string): string | undefined {
  const tool = name.replace(/^mcp__becode__/, "");
  const rest = title.startsWith(tool) ? title.slice(tool.length).trim() : title;
  return rest || undefined;
}

/** What the shimmer says while the run is live: the agent's own last words, not a generic label. */
function activeLabel(parts: BecodePart[]): string {
  const running = parts.findLast((part) => part.type === "tool" && part.state === "running");
  if (running?.type === "tool") return running.title;
  const said = parts.findLast((part) => part.type === "text" || part.type === "reasoning");
  const line = said && "text" in said ? said.text.trim().split("\n")[0] : "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line || "Working through it";
}

function summaryOf(tools: number, notes: number): string {
  const counted = [
    tools > 0 ? `${tools} tool ${tools === 1 ? "call" : "calls"}` : "",
    notes > 0 ? `${notes} ${notes === 1 ? "note" : "notes"}` : "",
  ].filter(Boolean);
  return counted.join(", ") || "Worked on it";
}

function AgentMessagePart({
  canRespond,
  onRespond,
  part,
}: {
  readonly canRespond: boolean;
  readonly onRespond: OnRespond;
  readonly part: BecodePart;
}) {
  switch (part.type) {
    // Sent attachments render inside the user bubble, above; nothing to show in the stream.
    case "file":
      return null;
    case "text":
      return <Markdown>{part.text}</Markdown>;
    case "approval":
      return (
        <ToolApproval
          description={part.reason}
          onApprove={
            canRespond && part.status === "pending" ? () => void onRespond(part.id, true) : undefined
          }
          onDeny={
            canRespond && part.status === "pending"
              ? () => void onRespond(part.id, false)
              : undefined
          }
          parameters={toolParameters(part.parameters)}
          status={part.status}
          title={part.title}
          tool={part.tool}
        />
      );
  }
}

/** Flatten a tool's input into the label/value rows the approval card renders. */
function toolParameters(input: unknown) {
  if (input === null || typeof input !== "object") return undefined;
  return Object.entries(input as Record<string, unknown>).map(([key, value]) => ({
    id: key,
    label: key,
    value: typeof value === "string" ? value : stringify(value),
  }));
}

function stringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function partKey(part: BecodePart, index: number): string {
  return part.type === "tool" || part.type === "approval"
    ? `${part.type}:${part.id}`
    : `${part.type}:${index}`;
}
