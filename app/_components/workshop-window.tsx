"use client";

import {
  ExternalLinkIcon,
  Loader2Icon,
  MonitorIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SmartphoneIcon,
  SquareIcon,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import type { ProjectDesign } from "@/agent/lib/impeccable";
import { Button } from "@/components/motion/button";
import { cn } from "@/lib/utils";
import { DesignSystemView } from "./design-system-view";
import { LogTail } from "./server-logs";

type Server = {
  name: string;
  url?: string;
  running: boolean;
  exitCode: number | null;
  pid?: number;
  app: boolean;
};
type Status = { branch?: string; servers: Server[] };
type Design = { design: ProjectDesign; docs: { path: string; text: string }[] };

/**
 * The rest state, and the only surface that exists before anything has been started.
 *
 * Namespaced rather than "design": surfaces are keyed by server name, and a project is free to
 * call one of its own servers anything it likes.
 */
const DESIGN = "becode:design-system";

/**
 * The window in the workshop wall.
 *
 * becode's own chrome is the frame; this is the only part of the page that shows something other
 * than becode. It holds one surface at a time — the project's design system at rest, an app once
 * it is serving, a log tail when one is booting or has died — and it is the only element in the
 * product carrying a shadow, because the lift is how the eye knows it is not chrome.
 *
 * It replaces two things that used to be summoned rather than looked at: a dot in the header with
 * a popover behind it, and a modal holding the logs. "Running" was a state you had to go and ask
 * about; now it is the thing in front of you. That is the whole point of `liveStatus()` returning
 * broken servers instead of filtering them out — there was nowhere to render them before.
 */
export function WorkshopWindow({
  onBranch,
  projectId,
  sessionId,
}: {
  /** The sidebar marks whichever chat holds the app ports. One poller in the app, not two. */
  readonly onBranch?: (branch?: string) => void;
  readonly projectId?: string;
  readonly sessionId?: string;
}) {
  const [status, setStatus] = useState<Status>({ servers: [] });
  const [surface, setSurface] = useState<string>(DESIGN);
  const [narrow, setNarrow] = useState(false);
  /**
   * Show the current app's output instead of the app.
   *
   * A running app's logs were reachable from the old status chip and became unreachable when the
   * window replaced it: only a *broken* server showed a tail. But the log you most want is often
   * from a server that is serving perfectly and rendering the wrong thing.
   */
  const [logs, setLogs] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const next = await fetch("/api/agent/status")
      .then((response) => response.json() as Promise<Status>)
      .catch(() => undefined);
    if (!next) return;
    setStatus(next);
    onBranch?.(next.branch);
  }, [onBranch]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const anyUp = status.servers.some((server) => server.running);
  const current = status.servers.find((server) => server.name === surface);

  /**
   * Follow the app the person is most likely to want, but never argue with a click.
   *
   * Only ever moves *to* a booted app from the rest state — once they have chosen a surface, a
   * poll five seconds later must not take it away from them.
   */
  useEffect(() => {
    if (surface !== DESIGN) return;
    const first = status.servers.find((server) => server.app && server.running && server.url);
    if (first) setSurface(first.name);
  }, [status.servers, surface]);

  // Start and stop are the same call with a different verb; the poll tells the truth afterwards.
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
      // First line only: `bootProject` appends the dead servers as JSON for the agent's benefit,
      // and the window already renders that output properly in the stage below.
      if (!response.ok) setError(body.message?.split("\n")[0] ?? "Could not start the project.");
      if (action === "stop") setSurface(DESIGN);
      await refresh();
    } catch {
      setError("Could not reach becode.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex min-w-0 flex-1 flex-col p-3 pl-0">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-observe">
        <header className="flex h-11 shrink-0 items-center gap-1 border-border/60 border-b pr-2 pl-2">
          <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            <SurfaceTab
              active={surface === DESIGN}
              label="Design system"
              onSelect={() => {
                setSurface(DESIGN);
                setLogs(false);
              }}
            />
            {status.servers.map((server) => (
              <SurfaceTab
                active={surface === server.name}
                key={server.name}
                label={server.name}
                onSelect={() => {
                  setSurface(server.name);
                  setLogs(false);
                }}
                state={server.running ? "live" : "fail"}
              />
            ))}
          </div>

          {current?.url && current.running && current.app ? (
            <>
              {logs ? null : (
                <>
                  <ToolbarButton
                    label={narrow ? "Show at full width" : "Show at phone width"}
                    onClick={() => setNarrow((previous) => !previous)}
                  >
                    {narrow ? <SmartphoneIcon /> : <MonitorIcon />}
                  </ToolbarButton>
                  <ToolbarButton label="Reload" onClick={() => setReloads((n) => n + 1)}>
                    <RotateCwIcon />
                  </ToolbarButton>
                </>
              )}
              <ToolbarButton
                active={logs}
                label={logs ? `Back to ${current.name}` : `What ${current.name} is saying`}
                onClick={() => setLogs((previous) => !previous)}
              >
                <ScrollTextIcon />
              </ToolbarButton>
              <ToolbarButton href={current.url} label={`Open ${current.name} in a new tab`}>
                <ExternalLinkIcon />
              </ToolbarButton>
            </>
          ) : null}

          {projectId || anyUp ? (
            <Button
              className="ml-1 shrink-0"
              disabled={pending || (!anyUp && !projectId)}
              onClick={() => void run(anyUp ? "stop" : "start")}
              size="sm"
              type="button"
              variant={anyUp ? "secondary" : "primary"}
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
        </header>

        {error ? (
          <p className="shrink-0 border-destructive/20 border-b bg-destructive/5 px-5 py-2 text-destructive text-xs">
            {error}
          </p>
        ) : null}

        <Stage
          key={`${surface}:${logs}`}
          logs={logs}
          narrow={narrow}
          projectId={projectId}
          reloads={reloads}
          server={current}
          surface={surface}
        />
      </div>
    </section>
  );
}

/**
 * One surface, exclusive with the others. Apps show themselves; anything else shows its output.
 *
 * Fades in on every swap. The transition from the design system at rest to the app running is the
 * one composed moment in the shell — it is becode proving the thing it claims — and a hard cut
 * makes it read as a page reload. Reduced motion gets the swap with no fade, not a slower one.
 */
function Stage({
  logs,
  narrow,
  projectId,
  reloads,
  server,
  surface,
}: {
  readonly logs: boolean;
  readonly narrow: boolean;
  readonly projectId?: string;
  readonly reloads: number;
  readonly server?: Server;
  readonly surface: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex min-h-0 flex-1 flex-col"
      initial={{ opacity: reduce ? 1 : 0 }}
      transition={{ duration: reduce ? 0 : 0.18, ease: EASE_OUT }}
    >
      <StageBody
        logs={logs}
        narrow={narrow}
        projectId={projectId}
        reloads={reloads}
        server={server}
        surface={surface}
      />
    </motion.div>
  );
}

function StageBody({
  logs,
  narrow,
  projectId,
  reloads,
  server,
  surface,
}: {
  readonly logs: boolean;
  readonly narrow: boolean;
  readonly projectId?: string;
  readonly reloads: number;
  readonly server?: Server;
  readonly surface: string;
}) {
  if (surface === DESIGN) return <DesignStage projectId={projectId} />;

  if (!server) {
    return <Quiet>{surface} is not running. Start the project to see it here.</Quiet>;
  }

  if (!server.running || !server.url) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="shrink-0 px-5 pt-4 font-medium text-base text-destructive">
          {server.name} is not serving
          {server.exitCode === null ? " yet" : ` — it exited ${server.exitCode}`}. Its output:
        </p>
        <LogTail name={server.name} />
      </div>
    );
  }

  // A service has a URL but is not a page — the backend answers with JSON, not something to look
  // at. Its logs are the reason it is in this row at all.
  if (!server.app) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="shrink-0 px-5 pt-4 text-muted-foreground text-sm">
          {server.name} is running on {server.url.replace("http://", "")}. Its output:
        </p>
        <LogTail name={server.name} />
      </div>
    );
  }

  if (logs) return <LogTail name={server.name} />;

  return (
    <div className={cn("min-h-0 flex-1", narrow && "grid place-items-center overflow-auto bg-muted/30 p-6")}>
      <iframe
        className={cn(
          "h-full w-full border-0 bg-white",
          narrow && "h-[844px] max-h-full w-[390px] shrink-0 rounded-xl border border-border/60",
        )}
        key={`${server.url}:${reloads}`}
        src={server.url}
        title={server.name}
      />
    </div>
  );
}

/**
 * The project's design system, in the project's own design language.
 *
 * The rest state, because it is the evidence behind becode's promise: a change will match the
 * product because this is what the product is made of. It also had no home in the loop: a
 * permalink at /design/[project] that you had to already know about.
 */
function DesignStage({ projectId }: { readonly projectId?: string }) {
  const [data, setData] = useState<Design>();
  const [missing, setMissing] = useState(false);
  const asked = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!projectId || asked.current === projectId) return;
    asked.current = projectId;
    setData(undefined);
    setMissing(false);
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/design`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<Design>)
          : Promise.reject(new Error(String(response.status))),
      )
      .then(setData)
      .catch(() => setMissing(true));
  }, [projectId]);

  if (!projectId) {
    return <Quiet>Pick a project in the rail, and what it is made of will show up here.</Quiet>;
  }
  if (missing) return <Quiet>Could not read {projectId}&rsquo;s design system.</Quiet>;
  if (!data) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <DesignSystemView design={data.design} docs={data.docs} project={projectId} />;
}

function Quiet({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6">
      <p className="max-w-sm text-balance text-center text-muted-foreground text-sm leading-relaxed">
        {children}
      </p>
    </div>
  );
}

function SurfaceTab({
  active,
  label,
  onSelect,
  state,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onSelect: () => void;
  readonly state?: "live" | "fail";
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
        active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
      type="button"
    >
      {state ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            state === "live" ? "bg-emerald-500" : "bg-rose-500",
          )}
        />
      ) : null}
      {label}
    </button>
  );
}

/** A square control, per the split: the pill is spent on Start, everything else is a square. */
function ToolbarButton({
  active,
  children,
  href,
  label,
  onClick,
}: {
  readonly active?: boolean;
  readonly children: React.ReactNode;
  readonly href?: string;
  readonly label: string;
  readonly onClick?: () => void;
}) {
  const className = cn(
    "grid size-7 shrink-0 place-items-center rounded-md outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
    active ? "bg-muted text-foreground" : "text-muted-foreground",
  );

  return href ? (
    <a aria-label={label} className={className} href={href} rel="noreferrer" target="_blank" title={label}>
      {children}
    </a>
  ) : (
    <button aria-label={label} className={className} onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}
