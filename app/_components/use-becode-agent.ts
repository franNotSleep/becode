"use client";

import { useCallback, useRef, useState } from "react";
import type { Attachment } from "@/agent/lib/attachments.ts";
import type { AgentEvent } from "@/agent/sdk/session.ts";

export type BecodePart =
  | { type: "text"; text: string }
  /** `src` is `/api/attachments/<sha>` once stored, and a `data:` URL for the turn being typed. */
  | { type: "file"; name: string; mediaType: string; src: string }
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
      tool: string;
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
  const [projectId, setProjectId] = useState<string>();
  const [openChatId, setOpenChatId] = useState<string>();
  const sessionId = useRef<string | undefined>(undefined);
  const abort = useRef<AbortController | undefined>(undefined);
  /** A ref, not state: `addProject` sets it and sends in the same tick. */
  const discoveryPath = useRef<string | undefined>(undefined);

  const apply = useCallback((event: AgentEvent) => {
    if (event.type === "session") {
      sessionId.current = event.sessionId;
      setOpenChatId(event.sessionId);
      return;
    }
    if (event.type === "error") {
      setError(event.message);
      return;
    }
    setMessages((previous) => reduce(previous, event));
  }, []);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      setError(undefined);
      setStatus("submitted");
      setMessages((previous) => [
        ...previous,
        {
          id: nextId(),
          role: "user",
          // The bytes are already in memory for the turn being sent, so this bubble renders them
          // directly. Every later read of the same chat gets `/api/attachments/<sha>` instead.
          parts: [
            ...attachments.map((a) => ({
              type: "file" as const,
              name: a.name,
              mediaType: a.mediaType,
              src: `data:${a.mediaType || "application/octet-stream"};base64,${a.data}`,
            })),
            { type: "text" as const, text },
          ],
        },
        { id: nextId(), role: "assistant", parts: [] },
      ]);

      const controller = new AbortController();
      abort.current = controller;

      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            sessionId: sessionId.current,
            projectId,
            discoveryPath: discoveryPath.current,
            attachments,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          // A refused attachment comes back as a 400 with a reason worth reading.
          const detail = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(detail?.message ?? `The agent did not respond (${response.status}).`);
        }
        if (!response.body) throw new Error("The agent returned an empty response.");

        setStatus("streaming");
        for await (const event of readNdjson(response.body)) apply(event);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        abort.current = undefined;
        setStatus("ready");
      }
    },
    [apply, projectId],
  );

  const cancel = useCallback(() => {
    abort.current?.abort();
  }, []);

  /** An empty chat, optionally already about a project — that is what scopes it before a word. */
  const startNew = useCallback((project?: string) => {
    abort.current?.abort();
    sessionId.current = undefined;
    discoveryPath.current = undefined;
    setOpenChatId(undefined);
    setProjectId(project);
    setMessages([]);
    setError(undefined);
  }, []);

  /**
   * Reopen a stored chat.
   *
   * The server replays it as the same event stream a live turn produces, so it folds through the
   * same reducer — a replayed tool row cannot render differently from the one that streamed.
   */
  const open = useCallback(async (id: string, project?: string) => {
    abort.current?.abort();
    discoveryPath.current = undefined;
    setError(undefined);
    setProjectId(project);
    setOpenChatId(id);
    sessionId.current = id;
    setMessages([]);
    const response = await fetch(`/api/sessions/${id}`);
    if (!response.ok) {
      setError("That chat could not be opened.");
      return;
    }
    const { events } = (await response.json()) as { events: AgentEvent[] };
    setMessages(events.reduce(reduce, []));
  }, []);

  /**
   * Point becode at a repo to add.
   *
   * The path opens a read grant for that one folder (`canUseTool` in session.ts) and the first
   * message is canned, because the person picked a folder rather than typing a request.
   */
  const addProject = useCallback(
    (repoPath: string) => {
      abort.current?.abort();
      sessionId.current = undefined;
      discoveryPath.current = repoPath;
      setOpenChatId(undefined);
      setProjectId(undefined);
      setMessages([]);
      setError(undefined);
      void send(
        `Add the repo at ${repoPath}. Read what it needs to boot — scripts, any compose file, ` +
          `env examples, the design tokens — then propose it with propose_project.`,
      );
    },
    [send],
  );

  /** Answer a pending approval. The server resolves the promise canUseTool is parked on. */
  const respond = useCallback(async (id: string, approved: boolean) => {
    setMessages((previous) => reduce(previous, { type: "approval-resolved", id, approved }));
    await fetch("/api/agent/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, approved }),
    }).catch(() => undefined);
  }, []);

  return {
    messages,
    status,
    error,
    projectId,
    openChatId,
    send,
    cancel,
    respond,
    startNew,
    open,
    addProject,
  };
}

/**
 * One event folded into the transcript.
 *
 * Pure and shared: the live stream calls it per event as they arrive, and a reopened chat calls it
 * over the replayed stream. There is only one place a tool row gets built.
 */
function reduce(messages: BecodeMessage[], event: AgentEvent): BecodeMessage[] {
  // Replay only. Live, the browser wrote this message itself before the request went out.
  if (event.type === "user") {
    return [
      ...messages,
      {
        id: nextId(),
        role: "user",
        parts: [
          ...event.files.map((f) => ({ type: "file" as const, ...f })),
          { type: "text" as const, text: event.text },
        ],
      },
      { id: nextId(), role: "assistant", parts: [] },
    ];
  }

  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return messages;
  const rest = messages.slice(0, -1);
  const put = (parts: BecodePart[]) => [...rest, { ...last, parts }];

  switch (event.type) {
    case "delta":
      return put(appendText(last.parts, "text", event.text));
    case "reasoning":
      return put(appendText(last.parts, "reasoning", event.text));
    case "tool":
      return put([
        ...last.parts,
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
      return put(
        last.parts.map((part) =>
          part.type === "tool" && part.id === event.id
            ? { ...part, state: event.ok ? "success" : "error", output: event.text }
            : part,
        ),
      );
    case "approval":
      return put([
        ...last.parts,
        {
          type: "approval",
          id: event.id,
          tool: event.tool,
          title: event.title,
          parameters: event.parameters,
          reason: event.reason,
          status: "pending",
        },
      ]);
    case "approval-resolved":
      return put(
        last.parts.map((part) =>
          part.type === "approval" && part.id === event.id
            ? { ...part, status: event.approved ? "approved" : "denied" }
            : part,
        ),
      );
    default:
      return messages;
  }
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
