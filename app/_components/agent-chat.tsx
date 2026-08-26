"use client";

import { AlertCircleIcon, CheckIcon, FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ACCEPT, type Attachment, isAllowed, MAX_FILES } from "@/agent/lib/attachments.ts";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { Message, MessageContent } from "@/components/agents/message";
import { MessageScroller } from "@/components/agents/message-scroller";
import { PromptInput } from "@/components/agents/prompt-input";
import { Button } from "@/components/motion/button";
import { badgeVariants } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { suggest } from "@/lib/skill-suggestions";
import { tokenize, typingSkill } from "@/lib/skill-tokens";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { ChatSidebar } from "./chat-sidebar";
import { LiveStatus } from "./live-status";
import { useBecodeAgent } from "./use-becode-agent";

const AGENT_NAME = "becode";

export function AgentChat({ skills }: { readonly skills: string[] }) {
  const agent = useBecodeAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.messages.length === 0;
  const lastMessage = agent.messages.at(-1);
  const isPendingAssistantShell = lastMessage?.role === "assistant" && lastMessage.parts.length === 0;
  const showPendingThinking = isBusy && isPendingAssistantShell;

  /**
   * Whether there is anything to ship, read off the transcript the client already holds.
   *
   * A successful `Edit`/`Write` means a change reached disk — they are gated, so success is the
   * proof — and a successful PR means it left. Derived rather than polled: a reopened chat replays
   * through the same reducer, so this is right there too, and gate 3 is the one that actually
   * decides. `start_task` would be the wrong signal: a policy refusal is still a successful call.
   *
   * The tool name is spelled out rather than imported from `TOOL` in agent/sdk/tools.ts — that
   * module spawns processes and opens sqlite, and this is a client component.
   */
  const shippable = useMemo(() => {
    let ready = false;
    for (const message of agent.messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || part.state !== "success") continue;
        if (part.name === "Edit" || part.name === "Write") ready = true;
        else if (part.name === "mcp__becode__open_pull_request") ready = false;
      }
    }
    return ready;
  }, [agent.messages]);

  const [liveBranch, setLiveBranch] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  // A finished turn is when a new chat first has a title worth listing.
  useEffect(() => {
    if (agent.status === "ready") setReloadKey((key) => key + 1);
  }, [agent.status]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // The composer is controlled only so a chip can write into it: PromptInput forwards no ref and
  // keeps its textarea private, so with `value` left undefined there is no way in.
  const [draft, setDraft] = useState("");
  const composerBox = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => (isBusy ? [] : suggest(draft)), [draft, isBusy]);

  /**
   * The skill being typed, read off the end of the draft rather than the caret.
   *
   * ponytail: the caret would need React's synthetic `onSelect`, which only fires under focus and
   * is the kind of thing that breaks quietly. Going back to fix a `/skill` mid-sentence gets no
   * menu; typing one gets it every time. Track the caret if editing in place ever matters.
   */
  const slashPrefix = typingSkill(draft, draft.length);
  const slashMatches = useMemo(
    () => (slashPrefix === null ? [] : skills.filter((name) => name.startsWith(slashPrefix))),
    [skills, slashPrefix],
  );

  /** Completing replaces the half-typed token, so slice it off rather than appending. */
  const completeSkill = (name: string) => {
    setDraft(draft.slice(0, draft.length - (slashPrefix?.length ?? 0)) + name + " ");
    composerBox.current?.querySelector("textarea")?.focus();
  };

  /** Append the routing sentence, then hand the caret back — nothing else refocuses on click. */
  const applySuggestion = (append: string) => {
    setDraft((previous) => (previous.trimEnd() + " " + append).trimStart());
    composerBox.current?.querySelector("textarea")?.focus();
  };

  /** Same allowlist the route enforces; this half only exists so a mistake reads immediately. */
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttachError(undefined);

    const refused = files.filter((file) => !isAllowed(file.name, file.type));
    if (refused.length > 0) {
      setAttachError(`becode takes images, PDFs and text — not ${refused[0].name}.`);
    }

    const accepted = files.filter((file) => isAllowed(file.name, file.type));
    if (accepted.length === 0) return;

    const read = await Promise.all(accepted.map(readAsAttachment));
    setAttachments((previous) => {
      const next = [...previous, ...read];
      if (next.length > MAX_FILES) {
        setAttachError(`becode takes ${MAX_FILES} attachments at a time.`);
        return next.slice(0, MAX_FILES);
      }
      return next;
    });
  };

  const handleSubmit = async (value: string) => {
    const text = value.trim();
    if (text.length === 0 || isBusy) return;
    const sending = attachments;
    setAttachments([]);
    setAttachError(undefined);
    setDraft("");
    await agent.send(text, sending);
  };

  const composer = (
    <div className="w-full">
      {shippable ? (
        <div className="mb-2 flex">
          <Button
            disabled={isBusy}
            onClick={() => void agent.send("Looks good. Open the pull request.")}
            size="sm"
            type="button"
            variant="secondary"
          >
            <CheckIcon className="size-3.5" />
            Ship this change
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-2xl border border-border/80 bg-background p-2 transition-colors focus-within:border-foreground/25",
          dragging && "border-foreground/40 bg-muted/40",
        )}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void addFiles([...event.dataTransfer.files]);
        }}
        ref={composerBox}
      >
        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-1 pt-1 pb-2">
            {attachments.map((attachment, index) => (
              <li key={`${attachment.name}:${index}`}>
                <AttachmentChip
                  attachment={attachment}
                  onRemove={() =>
                    setAttachments((previous) => previous.filter((_, i) => i !== index))
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}

        {slashMatches.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-1 pt-1 pb-2">
            {slashMatches.map((name) => (
              <li key={name}>
                <button
                  className={cn(
                    badgeVariants({ variant: "outline" }),
                    "cursor-pointer font-mono text-skill transition-colors hover:bg-muted",
                  )}
                  onClick={() => completeSkill(name)}
                  type="button"
                >
                  /{name}
                </button>
              </li>
            ))}
          </ul>
        ) : suggestions.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-1 pt-1 pb-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id}>
                <Tooltip>
                  <TooltipTrigger
                    className={cn(
                      badgeVariants({ variant: "outline" }),
                      "cursor-pointer transition-colors hover:bg-muted",
                    )}
                    onClick={() => applySuggestion(suggestion.append)}
                    type="button"
                  >
                    {suggestion.chip}
                  </TooltipTrigger>
                  <TooltipContent>{suggestion.skill}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        ) : null}

        <PromptInput
          className="border-0 bg-transparent p-0 focus-within:border-transparent"
          leadingAction={
            <Button
              aria-label="Attach a file"
              className="size-8 rounded-full"
              disabled={isBusy}
              onClick={() => fileInput.current?.click()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <PaperclipIcon className="size-4" />
            </Button>
          }
          loading={isBusy}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void addFiles(files);
          }}
          highlight={(text) =>
            tokenize(text, skills).map((token, index) =>
              token.skill ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional by nature
                <span className="text-skill" key={index}>
                  {token.text}
                </span>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional by nature
                <span key={index}>{token.text}</span>
              ),
            )
          }
          onStop={agent.cancel}
          onSubmit={handleSubmit}
          onValueChange={setDraft}
          // ponytail: the beUI composer will not submit an empty textarea, so an attachment still
          // needs a word beside it. Fork PromptInput's `canSubmit` if that ever grates.
          placeholder={attachments.length > 0 ? "What should becode do with it?" : "What should change?"}
          value={draft}
        />
      </div>

      <input
        accept={ACCEPT}
        className="hidden"
        multiple
        onChange={(event) => {
          void addFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
        ref={fileInput}
        type="file"
      />

      {attachError ? (
        <p className="mt-2 px-1 text-destructive text-xs">{attachError}</p>
      ) : null}
    </div>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <ChatSidebar
        activeChatId={agent.openChatId}
        activeProjectId={agent.projectId}
        liveBranch={liveBranch}
        onAddProject={agent.addProject}
        onNewChat={agent.startNew}
        onOpenChat={agent.open}
        reloadKey={reloadKey}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <span className="truncate text-muted-foreground text-sm">
            {agent.projectId ? `${AGENT_NAME} · ${agent.projectId}` : AGENT_NAME}
          </span>
          <LiveStatus onBranch={setLiveBranch} projectId={agent.projectId} sessionId={agent.openChatId} />
        </header>

        {agent.error ? (
          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 sm:px-6">
            <div
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm"
              role="alert"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Request failed</p>
                <p className="mt-0.5 text-muted-foreground">{agent.error}</p>
              </div>
            </div>
          </div>
        ) : null}

        {isEmpty ? null : (
          <MessageScroller
            busy={isBusy}
            className="min-h-0 flex-1"
            contentClassName="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-6 sm:px-6"
            label={`${AGENT_NAME} transcript`}
          >
            {agent.messages.map((message) =>
              showPendingThinking && message.id === lastMessage?.id ? null : (
                <AgentMessage
                  canRespond={!isBusy || agent.status === "streaming"}
                  key={message.id}
                  live={isBusy && message.id === lastMessage?.id}
                  message={message}
                  onRespond={agent.respond}
                />
              ),
            )}
            {showPendingThinking ? (
              <Message aria-live="polite" from="assistant">
                <MessageContent>
                  <ThinkingShimmer>Thinking</ThinkingShimmer>
                </MessageContent>
              </Message>
            ) : null}
          </MessageScroller>
        )}

        <div
          className={cn(
            "mx-auto w-full px-4 sm:px-6",
            isEmpty
              ? "flex max-w-xl flex-1 flex-col items-center justify-center gap-8 pb-[10vh]"
              : "max-w-3xl shrink-0 pb-6",
          )}
        >
          {isEmpty ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <h1 className="font-medium text-5xl tracking-tighter">{AGENT_NAME}</h1>
              <p className="text-balance text-muted-foreground">
                {agent.projectId
                  ? `Describe a change to ${agent.projectId}. You will see it running before it becomes a pull request.`
                  : "Describe a change. You will see it running before it becomes a pull request."}
              </p>
            </div>
          ) : null}
          {composer}
          </div>
      </main>
    </div>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  readonly attachment: Attachment;
  readonly onRemove: () => void;
}) {
  const isImage = attachment.mediaType.startsWith("image/");
  return (
    <span className="group flex items-center gap-2 rounded-lg border border-border/80 bg-muted/40 py-1 pr-1 pl-2 text-xs">
      {isImage ? (
        // biome-ignore lint/performance/noImgElement: a data: URL has nothing for next/image to optimise.
        <img
          alt=""
          className="size-6 shrink-0 rounded object-cover"
          src={dataUrl(attachment)}
        />
      ) : (
        <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="max-w-40 truncate">{attachment.name}</span>
      <button
        aria-label={`Remove ${attachment.name}`}
        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={onRemove}
        type="button"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}

export function dataUrl({ mediaType, data }: Attachment): string {
  return `data:${mediaType || "application/octet-stream"};base64,${data}`;
}

/** readAsDataURL rather than a hand-rolled base64 loop — the browser already does this. */
function readAsAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () =>
      resolve({
        name: file.name,
        mediaType: file.type,
        data: String(reader.result).split(",")[1] ?? "",
      });
    reader.readAsDataURL(file);
  });
}
