"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type {
  EveAuthorizationPart,
  EveDynamicToolPart,
  EveMessage,
  EveMessageInputRequest,
  EveMessagePart,
} from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { AgentActivity } from "@/components/agents/agent-activity";
import { ApprovalCard } from "@/components/agents/approval-card";
import type { ApprovalCardAnswers } from "@/components/agents/approval-card/types";
import { Message, MessageContent } from "@/components/agents/message";
import { ToolApproval } from "@/components/agents/tool-approval";
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AgentInputResponse = {
  readonly optionId?: string;
  readonly requestId: string;
  readonly text?: string;
};

type EveFilePart = Extract<EveMessagePart, { type: "file" }>;
type OnInputResponses = (responses: readonly AgentInputResponse[]) => void | Promise<void>;

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
  isStreaming,
  message,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly message: EveMessage;
  readonly onInputResponses: OnInputResponses;
}) {
  return (
    <Message
      animateIn
      data-optimistic={message.metadata?.optimistic ? "true" : undefined}
      from={message.role}
    >
      <MessageContent className="space-y-3">
        {message.parts.map((part, index) => (
          <AgentMessagePart
            canRespond={canRespond}
            isStreaming={isStreaming}
            key={partKey(part, index)}
            onInputResponses={onInputResponses}
            part={part}
          />
        ))}
      </MessageContent>
    </Message>
  );
}

function AgentMessagePart({
  canRespond,
  isStreaming,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly onInputResponses: OnInputResponses;
  readonly part: EveMessagePart;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return <Markdown>{part.text}</Markdown>;
    case "reasoning":
      return (
        <AgentActivity
          activeLabel="Thinking"
          contentType="text"
          items={[{ content: part.text, id: "reasoning", type: "text" }]}
          status={part.state === "streaming" ? "working" : "complete"}
          summary="Thought about it"
        />
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool":
      return (
        <ToolPart
          canRespond={canRespond}
          isStreaming={isStreaming}
          onInputResponses={onInputResponses}
          part={part}
        />
      );
  }
}

function ToolPart({
  canRespond,
  isStreaming,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly isStreaming: boolean;
  readonly onInputResponses: OnInputResponses;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;
  const inputResponse = part.toolMetadata?.eve?.inputResponse;

  // The agent is asking the user something mid-turn.
  if (inputRequest?.kind === "question") {
    return (
      <QuestionRequest
        canRespond={canRespond}
        inputRequest={inputRequest}
        inputResponse={inputResponse}
        onInputResponses={onInputResponses}
      />
    );
  }

  // A tool is gated on approval — becode's open_pull_request lands here.
  if (inputRequest) {
    const respond = (optionLabel: string) => {
      const option = inputRequest.options?.find(
        (candidate) => candidate.label.toLowerCase() === optionLabel,
      );
      if (!option) return;
      void onInputResponses([{ optionId: option.id, requestId: inputRequest.requestId }]);
    };

    return (
      <ToolApproval
        description={inputRequest.prompt}
        onApprove={canRespond ? () => respond("approve") : undefined}
        onDeny={canRespond ? () => respond("deny") : undefined}
        parameters={toolParameters(part.input)}
        status={approvalStatus(part, inputResponse !== undefined)}
        title={part.toolName}
        tool={part.toolName}
      />
    );
  }

  return (
    <ToolResult
      status={toolStatus(part, isStreaming)}
      title={summarizeInput(part.input) ?? part.toolName}
      tool={part.toolName}
    >
      <ToolResultOutput language="json">
        {part.errorText ?? stringify(part.output ?? part.input)}
      </ToolResultOutput>
    </ToolResult>
  );
}

function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse?: AgentInputResponse;
  readonly onInputResponses: OnInputResponses;
}) {
  const options = inputRequest.options ?? [];
  const acceptsFreeform = inputRequest.allowFreeform === true || options.length === 0;
  const answered = inputResponse !== undefined;
  const selectedOption = options.find((option) => option.id === inputResponse?.optionId);

  const submit = (answers: ApprovalCardAnswers) => {
    const answer = answers.question;
    if (!answer) return;
    void onInputResponses([
      {
        optionId: answer.selected[0],
        requestId: inputRequest.requestId,
        text: answer.custom,
      },
    ]);
  };

  return (
    <ApprovalCard
      onSubmit={canRespond && !answered ? submit : undefined}
      questions={[
        {
          allowCustom: acceptsFreeform,
          customPlaceholder: "Type your answer…",
          id: "question",
          options: options.map((option) => ({ label: option.label, value: option.id })),
          title: inputRequest.prompt,
        },
      ]}
      result={
        answered
          ? `Responded: ${selectedOption?.label ?? inputResponse.text ?? inputResponse.optionId}`
          : undefined
      }
      status={answered ? "answered" : "pending"}
      submitLabel="Answer"
    />
  );
}

function AttachmentPart({ part }: { readonly part: EveFilePart }) {
  const label = part.filename ?? "Attachment";
  const detail = [part.mediaType, formatBytes(part.size)].filter(Boolean).join(" · ");
  const isImage = part.mediaType.startsWith("image/") && part.url !== undefined;
  const Icon = isImage ? ImageIcon : FileIcon;
  const body = (
    <span className="flex max-w-sm items-center gap-3 rounded-lg border bg-background/60 p-2 text-sm">
      {isImage ? (
        <img alt={label} className="size-12 shrink-0 rounded-md object-cover" src={part.url} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        {detail ? <span className="block truncate text-muted-foreground">{detail}</span> : null}
      </span>
      {part.url ? <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" /> : null}
    </span>
  );

  return part.url ? (
    <a href={part.url} rel="noreferrer" target="_blank">
      {body}
    </a>
  ) : (
    body
  );
}

function AuthorizationPrompt({ part }: { readonly part: EveAuthorizationPart }) {
  const isAuthorized = part.state === "completed" && part.outcome === "authorized";
  const isCompleted = part.state === "completed";
  const Icon = isAuthorized ? CheckCircleIcon : isCompleted ? XCircleIcon : KeyRoundIcon;
  const instructions = part.authorization?.instructions;

  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-3",
        isAuthorized
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isCompleted
            ? "border-destructive/30 bg-destructive/5"
            : "border-blue-500/30 bg-blue-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            isAuthorized
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : isCompleted
                ? "bg-destructive/10 text-destructive"
                : "bg-blue-500/10 text-blue-700 dark:text-blue-300",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium text-sm">{authorizationTitle(part)}</p>
          <p className="text-muted-foreground text-sm">{authorizationDescription(part)}</p>
          {instructions !== undefined && instructions !== part.description ? (
            <p className="text-muted-foreground text-sm">{instructions}</p>
          ) : null}
          {part.state === "required" && part.authorization?.userCode ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Code</span>
              <code className="rounded-md bg-background px-2 py-1 font-mono">
                {part.authorization.userCode}
              </code>
            </div>
          ) : null}
          {part.state === "required" && part.authorization?.url ? (
            <Button asChild size="sm">
              <a href={part.authorization.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon className="size-4" />
                Sign in with {part.displayName}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function toolStatus(part: EveDynamicToolPart, isStreaming: boolean) {
  if (part.errorText !== undefined) return "error" as const;
  if (part.state === "output-available") return "success" as const;
  return isStreaming ? ("running" as const) : ("success" as const);
}

function approvalStatus(part: EveDynamicToolPart, responded: boolean) {
  if (!responded) return "pending" as const;
  if (part.errorText !== undefined) return "denied" as const;
  return "approved" as const;
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

/** A tool row reads better titled by what it acted on than by the tool's own name. */
function summarizeInput(input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "pattern", "projectId", "title", "request"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
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

function formatBytes(size: number | undefined): string | undefined {
  if (size === undefined) return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") return `Connect ${part.displayName}`;
  if (part.outcome === "authorized") return `${part.displayName} connected`;
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") return part.description;
  if (part.outcome === "authorized") return `${part.displayName} connected.`;
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";
  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(outcome: NonNullable<EveAuthorizationPart["outcome"]>): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }
}

function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${part.stepIndex}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${index}`;
  }
}
