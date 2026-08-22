"use client";

import { ExternalLinkIcon, Loader2Icon, PlayIcon, ScrollTextIcon, SquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@/components/motion/popover-morph";
import { Button } from "@/components/motion/button";
import { cn } from "@/lib/utils";
import { ServerLogs } from "./server-logs";

type Server = {
  name: string;
  url?: string;
  running: boolean;
  exitCode: number | null;
  pid?: number;
};
type Status = { branch?: string; servers: Server[] };

/**
 * Whether the target project is actually up, and where to look at it.
 *
 * ponytail: polls a route rather than opening a second stream — the source of truth is the
 * child processes on the server, and one dot does not need a socket. Nothing shows until
 * something has been started, so an idle becode has no chrome.
 *
 * A server that has died still appears, in red. Filtering to the healthy ones made a crashed
 * backend *vanish* from the bar, which is the opposite of what a status indicator is for.
 */
export function LiveStatus({
  onBranch,
  projectId,
  sessionId,
}: {
  readonly onBranch?: (branch?: string) => void;
  readonly projectId?: string;
  readonly sessionId?: string;
}) {
  const [status, setStatus] = useState<Status>({ servers: [] });
  const [logsFor, setLogsFor] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const tick = () =>
      fetch("/api/agent/status")
        .then((response) => response.json() as Promise<Status>)
        .then((next) => {
          setStatus(next);
          // The sidebar marks whichever chat holds the app ports. One poller, not two.
          onBranch?.(next.branch);
        })
        .catch(() => undefined);
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [onBranch]);

  const anyDown = status.servers.some((server) => !server.running);
  const anyUp = status.servers.some((server) => server.running);

  /** Start and stop are the same call with a different verb; the poll tells the truth after. */
  const run = async (action: "start" | "stop") => {
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, projectId, sessionId }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) setError(body.message ?? "Could not start the project.");
      else setStatus(await (await fetch("/api/agent/status")).json());
    } catch {
      setError("Could not reach becode.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      {error ? <span className="truncate text-destructive">{error}</span> : null}

      {projectId || anyUp ? (
        <Button
          className="shrink-0"
          disabled={pending || (!anyUp && !projectId)}
          onClick={() => void run(anyUp ? "stop" : "start")}
          size="sm"
          type="button"
          variant="secondary"
        >
          {pending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : anyUp ? (
            <SquareIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {anyUp ? "Stop" : "Start"}
        </Button>
      ) : null}

      {status.servers.length === 0 ? null : (
      <>
      <span aria-hidden className="relative flex size-2 shrink-0">
        {anyDown ? (
          <span className="relative inline-flex size-2 rounded-full bg-destructive" />
        ) : (
          <>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </>
        )}
      </span>
      <span className="sr-only">Running:</span>

      {status.servers.map((server) => (
        <ServerChip key={server.name} onLogs={() => setLogsFor(server.name)} server={server} />
      ))}

      <ServerLogs name={logsFor} onOpenChange={(open) => !open && setLogsFor(undefined)} />
      </>
      )}
    </div>
  );
}

/** One server. Clicking it offers the two things you can do with it: look at it, or read it. */
function ServerChip({ onLogs, server }: { readonly onLogs: () => void; readonly server: Server }) {
  const [open, setOpen] = useState(false);
  const row =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted";

  return (
    <MorphPopover onOpenChange={setOpen} open={open}>
      <MorphPopoverTrigger>
        <button
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 transition-colors hover:bg-accent",
            server.running ? "text-foreground" : "border-destructive/40 text-destructive",
          )}
          type="button"
        >
          {server.name}
          <span className={cn("ml-1", server.running ? "text-muted-foreground" : "text-destructive/70")}>
            {server.running
              ? server.url
                ? `:${new URL(server.url).port}`
                : "up"
              : `exited ${server.exitCode ?? ""}`}
          </span>
        </button>
      </MorphPopoverTrigger>

      <MorphPopoverContent align="end" className="w-52 p-1.5" radius={12} side="bottom" sideOffset={8}>
        {server.url ? (
          <a
            className={row}
            href={server.url}
            onClick={() => setOpen(false)}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLinkIcon className="size-4 text-muted-foreground" />
            Open {server.name}
          </a>
        ) : null}
        <button
          className={row}
          onClick={() => {
            setOpen(false);
            onLogs();
          }}
          type="button"
        >
          <ScrollTextIcon className="size-4 text-muted-foreground" />
          Logs
        </button>
      </MorphPopoverContent>
    </MorphPopover>
  );
}
