"use client";

import { AlertCircleIcon, FileTextIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { ACCEPT, type Attachment, isAllowed, MAX_FILES } from "@/agent/lib/attachments.ts";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { Message, MessageContent } from "@/components/agents/message";
import { MessageScroller } from "@/components/agents/message-scroller";
import { PromptInput } from "@/components/agents/prompt-input";
import { Button } from "@/components/motion/button";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { LiveStatus } from "./live-status";
import { useBecodeAgent } from "./use-becode-agent";

const AGENT_NAME = "becode";

export function AgentChat() {
  const agent = useBecodeAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.messages.length === 0;
  const lastMessage = agent.messages.at(-1);
  const isPendingAssistantShell = lastMessage?.role === "assistant" && lastMessage.parts.length === 0;
  const showPendingThinking = isBusy && isPendingAssistantShell;

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

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
    await agent.send(text, sending);
  };

  const composer = (
    <div className="w-full">
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
          onStop={agent.cancel}
          onSubmit={handleSubmit}
          // ponytail: the beUI composer will not submit an empty textarea, so an attachment still
          // needs a word beside it. Fork PromptInput's `canSubmit` if that ever grates.
          placeholder={attachments.length > 0 ? "What should becode do with it?" : "What should change?"}
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
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6">
          <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
          <LiveStatus />
        </header>
      )}

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
          contentClassName="mx-auto w-full max-w-3xl gap-6 px-4 py-6 sm:px-6"
          label={`${AGENT_NAME} transcript`}
        >
          {agent.messages.map((message) =>
            showPendingThinking && message.id === lastMessage?.id ? null : (
              <AgentMessage
                canRespond={!isBusy || agent.status === "streaming"}
                key={message.id}
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
              Describe a change. You will see it running before it becomes a pull request.
            </p>
          </div>
        ) : null}
        {composer}
      </div>
    </main>
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
