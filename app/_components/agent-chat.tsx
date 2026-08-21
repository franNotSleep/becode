"use client";

import { AlertCircleIcon } from "lucide-react";
import { ThinkingShimmer } from "@/components/agents/loading-states/thinking-shimmer";
import { Message, MessageContent } from "@/components/agents/message";
import { MessageScroller } from "@/components/agents/message-scroller";
import { PromptInput } from "@/components/agents/prompt-input";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./agent-message";
import { useBecodeAgent } from "./use-becode-agent";

const AGENT_NAME = "becode";

export function AgentChat() {
  const agent = useBecodeAgent();
  const isBusy = agent.status === "submitted" || agent.status === "streaming";
  const isEmpty = agent.messages.length === 0;
  const lastMessage = agent.messages.at(-1);
  const isPendingAssistantShell = lastMessage?.role === "assistant" && lastMessage.parts.length === 0;
  const showPendingThinking = isBusy && isPendingAssistantShell;

  const handleSubmit = async (value: string) => {
    const text = value.trim();
    if (text.length === 0 || isBusy) return;
    await agent.send(text);
  };

  const composer = (
    <PromptInput
      loading={isBusy}
      onStop={agent.cancel}
      onSubmit={handleSubmit}
      placeholder="What should change?"
    />
  );

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {isEmpty ? null : (
        <header className="flex h-14 shrink-0 items-center justify-center px-4">
          <span className="truncate text-muted-foreground text-sm">{AGENT_NAME}</span>
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
        <div className="w-full">{composer}</div>
      </div>
    </main>
  );
}
