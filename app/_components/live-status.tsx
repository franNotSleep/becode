"use client";

import { useEffect, useState } from "react";

type Status = { branch?: string; servers: { name: string; url?: string }[] };

/**
 * Whether the target project is actually up, and where to look at it.
 *
 * ponytail: polls a route rather than opening a second stream — the source of truth is the
 * child processes on the server, and one dot does not need a socket. Nothing shows until
 * something is running, so an idle becode has no chrome.
 */
export function LiveStatus({ onBranch }: { readonly onBranch?: (branch?: string) => void }) {
  const [status, setStatus] = useState<Status>({ servers: [] });

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

  if (status.servers.length === 0) return null;

  const apps = status.servers.filter((server) => server.url);
  const services = status.servers.filter((server) => !server.url);

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span aria-hidden className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <span className="sr-only">Running:</span>
      {services.length > 0 ? (
        <span className="hidden truncate text-muted-foreground sm:inline">
          {services.map((service) => service.name).join(" · ")}
        </span>
      ) : null}
      {apps.map((app) => (
        <a
          className="shrink-0 rounded-md border px-2 py-1 transition-colors hover:bg-accent"
          href={app.url}
          key={app.name}
          rel="noreferrer"
          target="_blank"
        >
          {app.name}
          <span className="ml-1 text-muted-foreground">:{new URL(app.url!).port}</span>
        </a>
      ))}
    </div>
  );
}
