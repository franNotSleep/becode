"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Dev servers colour their output. Rendering the escape codes literally turns a stack trace into
 * `ESC[90m` noise, and this pane has no terminal to interpret them.
 */
const stripAnsi = (text: string) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");

type Log = { text: string; to: number; truncated: boolean };

/**
 * What a server actually said, inline in the window.
 *
 * ponytail: a 1s cursor poll, not SSE. A person reading a log cannot tell a second from live, the
 * buffer outlives both the reader and the process, and a poll has no subscription to tear down
 * when the tab closes.
 *
 * This used to be a dialog opened from a chip in the header. It is not one any more: a crashed
 * server is something you look at, not something you go and open, so the window renders it in
 * place of the app that failed to appear.
 */
export function LogTail({
  className,
  name,
}: {
  readonly className?: string;
  readonly name: string;
}) {
  const [text, setText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [reached, setReached] = useState(false);
  const pane = useRef<HTMLPreElement>(null);
  const cursor = useRef(0);

  useEffect(() => {
    cursor.current = 0;
    setText("");
    setTruncated(false);
    setReached(false);
    let cancelled = false;

    const tick = async () => {
      const response = await fetch(
        `/api/agent/logs?name=${encodeURIComponent(name)}&from=${cursor.current}`,
      ).catch(() => null);
      if (cancelled || !response?.ok) return;
      const next = (await response.json()) as Log;
      cursor.current = next.to;
      setReached(true);
      setTruncated(next.truncated);
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
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 80) {
      node.scrollTop = node.scrollHeight;
    }
  }, [text]);

  return (
    <pre
      className={cn(
        "scrollbar-hide min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-5 py-4",
        "font-mono text-muted-foreground text-xs leading-5",
        className,
      )}
      ref={pane}
    >
      {truncated ? (
        <span className="text-muted-foreground/60">[earlier output dropped]{"\n"}</span>
      ) : null}
      {stripAnsi(text) || (reached ? "(no output yet)" : "…")}
    </pre>
  );
}
