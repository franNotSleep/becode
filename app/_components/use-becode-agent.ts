"use client";

import { useCallback, useRef, useState } from "react";
import type { AgentEvent } from "@/agent/sdk/session.ts";

export type BecodePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      title: string;
      input: unknown;
      state: "running" | "success" | "error";
      output?: string;
    }
  | {
      type: "approval";
      id: string;
      title: string;
      parameters: unknown;
      reason: string;
      status: "pending" | "approved" | "denied";
    };

export type BecodeMessage = {
  id: string;
  role: "user" | "assistant";
  parts: BecodePart[];
};

export type AgentStatus = "ready" | "submitted" | "streaming";

let counter = 0;
const nextId = () => `m${++counter}`;

export function useBecodeAgent() {
  const [messages, setMessages] = useState<BecodeMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>("ready");
  const [error, setError] = useState<string>();
  const sessionId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);

  /** Rewrite the trailing assistant message. Every event lands as a change to its parts. */
  const patch = useCallback((update: (parts: BecodePart[]) => BecodePart[]) => {
    setMessages((previous) => {
      const last = previous.at(-1);
      if (!last || last.role !== "assistant") return previous;
      return [...previous.slice(0, -1), { ...last, parts: update(last.parts) }];
    });
  }, []);

  const apply = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "session":
          sessionId.current = event.sessionId;
          return;
        case "delta":
          return patch((parts) => appendText(parts, "text", event.text));
        case "reasoning":
          return patch((parts) => appendText(parts, "reasoning", event.text));
        case "tool":
          return patch((parts) => [
            ...parts,
            {
              type: "tool",
              id: event.id,
              name: event.name,
              title: event.title,
              input: event.input,
              state: "running",
            },
          ]);
        case "tool-result":
          return patch((parts) =>
            parts.map((part) =>
              part.type === "tool" && part.id === event.id
                ? { ...part, state: event.ok ? "success" : "error", output: event.text }
                : part,
            ),
          );
        case "approval":
          return patch((parts) => [
            ...parts,
            {
              type: "approval",
              id: event.id,
              title: event.title,
              parameters: event.parameters,
              reason: event.reason,
              status: "pending",
            },
          ]);
        case "approval-resolved":
          return patch((parts) =>
            parts.map((part) =>
              part.type === "approval" && part.id === event.id
                ? { ...part, status: event.approved ? "approved" : "denied" }
                : part,
            ),
          );
        case "error":
          setError(event.message);
          return;
        case "done":
          return;
      }
    },
    [patch],
  );

  const send = useCallback(
    async (text: string) => {
      setError(undefined);
      setStatus("submitted");
      setMessages((previous) => [
        ...previous,
        { id: nextId(), role: "user", parts: [{ type: "text", text }] },
        { id: nextId(), role: "assistant", parts: [] },
      ]);

      const controller = new AbortController();
      abort.current = controller;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, sessionId: sessionId.current }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`The agent did not respond (${response.status}).`);
        }

        setStatus("streaming");
        for await (const event of readNdjson(response.body)) apply(event);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        abort.current = undefined;
        setStatus("ready");
      }
    },
    [apply],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  /** Answer a pending approval. The server resolves the promise canUseTool is parked on. */
  const respond = useCallback(async (id: string, approved: boolean) => {
    patch((parts) =>
      parts.map((part) =>
        part.type === "approval" && part.id === id
          ? { ...part, status: approved ? "approved" : "denied" }
          : part,
      ),
    );
    await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approved }),
    }).catch(() => undefined);
  }, [patch]);

  return { messages, status, error, send, cancel, respond };
}

/** Streaming text lands in the trailing part of its kind rather than a new part per token. */
function appendText(parts: BecodePart[], kind: "text" | "reasoning", text: string): BecodePart[] {
  const last = parts.at(-1);
  if (last?.type === kind) {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { type: kind, text }];
}

async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield JSON.parse(line) as AgentEvent;
      newline = buffer.indexOf("\n");
    }
  }

  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as AgentEvent;
}
