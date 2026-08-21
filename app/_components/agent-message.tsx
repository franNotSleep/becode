"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { AgentActivity } from "@/components/agents/agent-activity";
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "@/components/agents/message";
import { ToolApproval } from "@/components/agents/tool-approval";
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";
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
  message,
  onRespond,
}: {
  readonly canRespond: boolean;
  readonly message: BecodeMessage;
  readonly onRespond: OnRespond;
}) {
  // What the CEO typed reads as something they said: a bubble on their side. What becode says is
  // the document — full width, no container, so a diff or a URL is not squeezed into a chat bubble.
  if (message.role === "user") {
    return (
      <Message animateIn from="user">
        <MessageContent>
          <MessageBubble animateIn variant="soft">
            <MessageBubbleContent>{plainText(message)}</MessageBubbleContent>
          </MessageBubble>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message animateIn from="assistant">
      <MessageContent className="space-y-3">
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            key={partKey(part, index)}
            onRespond={onRespond}
            part={part}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function plainText(message: BecodeMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
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
    case "text":
      return <Markdown>{part.text}</Markdown>;
    case "reasoning":
      return (
        <AgentActivity
          activeLabel="Thinking"
          contentType="text"
          items={[{ content: part.text, id: "reasoning", type: "text" }]}
          status="complete"
          summary="Thought about it"
        />
      );
    case "tool":
      return (
        <ToolResult status={part.state} title={part.title} tool={part.name}>
          <ToolResultOutput language="json">
            {part.output ?? stringify(part.input)}
          </ToolResultOutput>
        </ToolResult>
      );
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
          tool="open_pull_request"
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
