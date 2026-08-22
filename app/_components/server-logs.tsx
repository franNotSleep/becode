"use client";

import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Dev servers colour their output. Rendering the escape codes literally turns a stack trace into
 * `\u001b[90m` noise, and this pane has no terminal to interpret them.
 */
const stripAnsi = (text: string) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  text.replace(/\u001b\[[0-9;?]*[a-zA-Z]/g, "");

type Log = {
  name: string;
  url?: string;
  running: boolean;
  exitCode: number | null;
  pid?: number;
  text: string;
  to: number;
  truncated: boolean;
};

/**
 * What a server actually said.
 *
 * ponytail: a 1s cursor poll, not SSE. A person reading a log cannot tell a second from live, the
 * buffer outlives both the modal and the process, and a poll has no subscription to tear down when
 * the tab closes.
 */
export function ServerLogs({
  name,
  onOpenChange,
}: {
  /** The server to show; `undefined` closes the dialog. */
  readonly name?: string;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [log, setLog] = useState<Log>();
  const [text, setText] = useState("");
  const pane = useRef<HTMLPreElement>(null);
  const cursor = useRef(0);

  useEffect(() => {
    if (!name) return;
    cursor.current = 0;
    setText("");
    setLog(undefined);
    let cancelled = false;

    const tick = async () => {
      const response = await fetch(
        `/api/agent/logs?name=${encodeURIComponent(name)}&from=${cursor.current}`,
      ).catch(() => null);
      if (cancelled || !response?.ok) return;
      const next = (await response.json()) as Log;
      cursor.current = next.to;
      setLog(next);
      // Only new bytes are appended, so the pane does not re-render the whole log every second.
      if (next.text) setText((previous) => (next.truncated ? next.text : previous + next.text));
    };

    void tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [name]);

  // Follow the tail, unless the reader has scrolled up to look at something.
  useEffect(() => {
    const node = pane.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    if (atBottom) node.scrollTop = node.scrollHeight;
  }, [text]);

  return (
    <Dialog onOpenChange={onOpenChange} open={!!name}>
      <DialogContent className="max-w-3xl gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 border-border/60 border-b px-4 py-3">
          <DialogTitle className="font-medium text-sm">{name}</DialogTitle>
          {log ? (
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs",
                log.running ? "text-muted-foreground" : "text-destructive",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  log.running ? "bg-emerald-500" : "bg-destructive",
                )}
              />
              {log.running ? `running${log.pid ? ` · pid ${log.pid}` : ""}` : `exited ${log.exitCode ?? ""}`}
            </span>
          ) : null}
          {log?.url ? (
            <a
              className="ml-auto flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              href={log.url}
              rel="noreferrer"
              target="_blank"
            >
              {log.url.replace("http://", "")}
              <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
        </DialogHeader>

        <pre
          className="scrollbar-hide max-h-[60vh] min-h-60 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-muted-foreground text-xs leading-5"
          ref={pane}
        >
          {log?.truncated ? (
            <span className="text-muted-foreground/60">[earlier output dropped]{"\n"}</span>
          ) : null}
          {stripAnsi(text) || (log ? "(no output yet)" : "…")}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
