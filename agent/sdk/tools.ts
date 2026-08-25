import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addProject, allProjects, findProject } from "../lib/db.ts";
import { append, emptyBuffer, type LogBuffer, since, tail } from "../lib/logs.ts";
import { isListening } from "../lib/ports.ts";
import { appUrls, type Project } from "../lib/projects.ts";
import { changedFiles, createWorktree, git } from "../lib/git.ts";
import { rolePolicy } from "../lib/roles.ts";
import { fileIssue, hasLinear } from "../lib/linear.ts";
import { activeTask, type Chat, recordShipped, resolveInWorktree, setTask } from "../lib/task.ts";
import { judgeRequest } from "./judge.ts";

const exec = promisify(execFile);

/** Everything a tool returns reaches the model as text. */
const reply = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/**
 * becode's tools, bound to one chat.
 *
 * A factory rather than a module-level server: `tool()`'s handler is given `extra: unknown`, so
 * the SDK offers no way to tell which chat a call came from. Closing over the `Chat` is what lets
 * two chats hold two worktrees at once.
 */
export function becodeTools(chat: Chat) {
  const listProjects = tool(
    "list_projects",
    "List the projects becode can work on, and the role this becode is running as. " +
      "Call this first if you are unsure which project the user means.",
    {},
    async () => {
      const role = rolePolicy();
      return reply({
        role: role.name,
        policy: role.text,
        projects: allProjects().map((p) => ({ id: p.id, baseBranch: p.baseBranch })),
        // The person opened this chat on a project, so there is nothing to ask about.
        ...(chat.projectId ? { thisChatIsAbout: chat.projectId } : {}),
      });
    },
    { annotations: { readOnlyHint: true } },
  );

  const startTask = tool(
    "start_task",
    "Start work on a project. First checks the user's request against this becode's role policy, " +
      "then creates an isolated git worktree on a fresh branch. Call this before touching anything. " +
      "If it comes back refused, tell the user why and stop — do not look for another way in.",
    {
      projectId: z
        .string()
        .optional()
        .describe("Project id from list_projects. Omit when this chat is already about a project."),
      request: z
        .string()
        .describe(
          "What the user asked for, in their own words and in full. Do not soften it, summarise " +
            "away the part you are unsure about, or restate it as something more acceptable.",
        ),
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lowercase letters, digits and dashes")
        .describe("Short kebab-case name for the change, e.g. 'roomier-ticket-card'."),
    },
    async ({ projectId, request, slug }) => {
      const id = projectId ?? chat.projectId;
      if (!id) throw new Error("Which project? Call list_projects and ask the user.");
      const project = findProject(id);

      if (chat.task) {
        throw new Error(
          `This chat is already working on ${chat.task.projectId} (${chat.task.branch}). ` +
            `Finish or abandon it first. A second change belongs in a new chat.`,
        );
      }

      const verdict = await judgeRequest(request);
      if (!verdict.allowed) {
        return reply({ started: false, refused: verdict.reason });
      }

      const { dir, branch } = await createWorktree({
        repo: project.path,
        projectId: id,
        taskId: slug,
        baseBranch: project.baseBranch,
      });

      setTask(chat, { projectId: id, request, worktree: dir, branch });

      const designSystem = await Promise.all(
        (project.designSystem ?? []).map(async (rel) => {
          const stat = await fs.stat(resolveInWorktree(dir, rel)).catch(() => null);
          return { path: rel, exists: stat !== null, isDirectory: stat?.isDirectory() ?? false };
        }),
      );

      return reply({
        started: true,
        branch,
        worktree: dir,
        designSystem,
        next:
          `Use absolute paths under ${dir} for the rest of this turn — the working directory was ` +
          `fixed before this worktree existed. ` +
          (designSystem.length
            ? "Read the design system files before making any visual change."
            : "No design system is configured for this project."),
      });
    },
  );

  const proposeProject = tool(
    "propose_project",
    "Register a repo becode can work on, once you have worked out how to boot it. Read the repo " +
      "first — package.json scripts, any compose file, .env.example, the design tokens — and " +
      "propose the smallest recipe that actually starts it. The user confirms before it is saved.",
    {
      project: z.object({
        id: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "lowercase letters, digits and dashes")
          .describe("Short id, usually the repo name."),
        path: z.string().describe("Absolute path to the repo. Must be the folder the user picked."),
        baseBranch: z.string().describe("The branch pull requests target. Never committed to."),
        install: z
          .string()
          .optional()
          .describe("Command run once in a fresh worktree, e.g. 'pnpm install --frozen-lockfile'."),
        apps: z
          .array(
            z.object({
              name: z.string().describe("What the person would call this surface."),
              command: z
                .string()
                .describe("Dev command with $PORT where the port goes. Bypass scripts that pin one."),
              port: z.number().int().describe("The port its env and any CORS allowlist expect."),
            }),
          )
          .min(1)
          .describe("The surfaces a person looks at. One URL each, started in the task worktree."),
        services: z
          .array(
            z.object({
              name: z.string(),
              command: z.string(),
              port: z
                .number()
                .int()
                .optional()
                .describe("The port it binds, from its own env. Never substituted — read, not set."),
            }),
          )
          .optional()
          .describe("Db, queue, api. Started in the source checkout, shared across tasks."),
        designSystem: z
          .array(z.string())
          .optional()
          .describe("Repo-relative files that define the look — tokens, theme config, ui folder."),
      }),
    },
    /** The gate is in canUseTool: a person confirms, and the path must be the one they picked. */
    async ({ project }) => {
      const stat = await fs.stat(path.join(project.path, ".git")).catch(() => null);
      if (!stat) throw new Error(`${project.path} is not a git repository.`);

      addProject(project);
      chat.discoveryRoot = undefined;
      return reply({
        added: project.id,
        next: `Tell the user it is added. It will be in the sidebar; a new chat on it can start work.`,
      });
    },
  );

  const runProject = tool(
    "run_project",
    "Boot the current project's apps (and the services they need) and return a URL for each one. " +
      "Call this after making a change so the user can see it. Anything already running is left " +
      "alone — dev servers hot-reload, so a second call is cheap. If another chat's apps hold " +
      "these ports, they are stopped first: one screen shows one branch.",
    {
      install: z
        .boolean()
        .default(false)
        .describe("Run the install command first. Needed on a fresh worktree."),
    },
    async ({ install }) => {
      const { task: current, project } = activeTask(chat);
      return reply(await bootProject(project, current.worktree, current.branch, install));
    },
  );

  const readLogs = tool(
    "read_logs",
    "Read the output of something becode is running — a dev server, the api, the database. Use it " +
      "when run_project reports something is not running, or when the app misbehaves and you need " +
      "to know why. Output is kept after a process dies, so the error that killed it is still here.",
    {
      name: z
        .string()
        .optional()
        .describe("Server name from run_project. Omit for a short tail of every one."),
    },
    async ({ name }) => {
      if (name) {
        const server = live.get(name);
        if (!server) {
          throw new Error(
            `Nothing called "${name}" is running. Known: ${[...live.keys()].join(", ") || "nothing yet"}.`,
          );
        }
        return reply({
          name,
          running: await serverUp(server),
          exitCode: server.child.exitCode,
          logs: tail(server.logs, 8000) || "(no output yet)",
        });
      }

      return reply(
        await Promise.all(
          [...live.values()].map(async (server) => ({
            name: server.name,
            running: await serverUp(server),
            exitCode: server.child.exitCode,
            logs: tail(server.logs, 1500) || "(no output yet)",
          })),
        ),
      );
    },
    { annotations: { readOnlyHint: true } },
  );

  const openPullRequest = tool(
    "open_pull_request",
    "Open a pull request with the work in the current task worktree. This is the only way a " +
      "change leaves becode. Call it once the user has looked at the running app and approved. " +
      "A Linear issue is filed first and its identifier goes in the branch name, so the PR and " +
      "the issue link up. If the result carries a warning, the PR is open but untracked — say so.",
    {
      title: z.string().describe("PR title, in the user's words, not a commit-message summary."),
      body: z
        .string()
        .describe("What changed and why, for a reviewer who did not see the conversation."),
    },
    /**
     * The gates live in canUseTool (agent/sdk/session.ts): it judges the real diff against the
     * original request and then waits for the person to confirm. By the time this runs, both
     * have passed — so this only does the outward-facing part.
     */
    async ({ title, body }) => {
      const { task: current, project } = activeTask(chat);
      const files = await changedFiles(current.worktree);

      await git(current.worktree, "commit", "-m", title, "-m", body);

      // Linear first, because the identifier has to be in the branch name before it is pushed —
      // that name is the whole link. A failure here is a warning, never a throw: an outage in the
      // bookkeeping must not strand a committed change with no way out.
      const issue = hasLinear()
        ? await fileIssue({
            title,
            request: current.request,
            body,
            branch: current.branch,
            projectId: current.projectId,
          }).catch((error: Error) => error)
        : undefined;
      const filed = issue instanceof Error ? undefined : issue;

      // Pushed under the issue's name, not renamed to it. `appOwner` (below) is keyed on the
      // branch `run_project` booted the apps under, so a local `git branch -m` would make the
      // release miss and leave dev servers on :3000/:3002 serving a worktree the next task reuses.
      // GitHub is the only place the name has to be right — Linear reads it there.
      const head = filed
        ? `becode/${filed.identifier.toLowerCase()}-${current.branch.replace(/^becode\//, "")}`
        : current.branch;

      await git(current.worktree, "push", "--set-upstream", "origin", `HEAD:refs/heads/${head}`);

      const { stdout } = await exec(
        "gh",
        ["pr", "create", "--base", project.baseBranch, "--head", head, "--title", title, "--body", body],
        { cwd: current.worktree },
      );

      const url = stdout.trim().split("\n").pop() ?? "";
      recordShipped(chat, {
        issue: filed?.identifier,
        issueUrl: filed?.url,
        prUrl: url,
        branch: head,
        at: Date.now(),
      });
      setTask(chat, null);

      // The apps were serving this worktree. Left running, the next task would show its code.
      // Only this chat's, though — another chat may have taken the ports since. `current.branch`,
      // not `head`: the local branch never moved, and that is what took the ports.
      takeAppPorts(undefined, current.branch);
      return reply({
        url,
        branch: head,
        files,
        ...(filed ? { issue: filed.identifier, issueUrl: filed.url } : {}),
        ...(issue instanceof Error
          ? {
              warning:
                `The pull request is open, but Linear did not accept the issue (${issue.message}). ` +
                `Tell the user it is untracked, and that the branch is ${head}.`,
            }
          : {}),
      });
    },
  );

  return createSdkMcpServer({
    name: "becode",
    instructions:
      "becode's own tools. Everything else you need — reading, searching and editing the target " +
      "repo — is a built-in tool rooted at the task worktree.",
    tools: [listProjects, startTask, runProject, readLogs, openPullRequest, proposeProject],
  });
}

/**
 * Everything becode has booted, keyed by name.
 *
 * Module-level on purpose, unlike the per-chat task: these are host ports, and there is only one
 * set of them. `appOwner` is the branch whose code the apps are currently serving.
 *
 * ponytail: an in-process map, not a supervisor. becode is one local process serving one
 * person; if it ever needs to survive a restart, move this to a pidfile in the worktree.
 */
type Server = {
  name: string;
  url?: string;
  port?: number;
  /** An app (worktree, takeable port) rather than a shared service. Services have URLs too now. */
  app: boolean;
  child: ChildProcess;
  logs: LogBuffer;
};

const live = new Map<string, Server>();
let appOwner: string | undefined;

/**
 * Hand the app ports to `branch`, stopping whatever was on them, and report what was displaced.
 *
 * Services are untouched — they are shared infrastructure on fixed ports, run from the source
 * checkout, and every task needs them. With `onlyIfOwnedBy`, does nothing unless that branch still
 * holds the ports: a finishing task must not kill apps another chat has since taken over.
 */
function takeAppPorts(branch: string | undefined, onlyIfOwnedBy?: string): string | undefined {
  if (onlyIfOwnedBy !== undefined && appOwner !== onlyIfOwnedBy) return undefined;
  const displaced = appOwner === branch ? undefined : appOwner;
  if (appOwner !== branch) {
    for (const [name, entry] of live) {
      if (!entry.app) continue;
      stop(entry.child);
      live.delete(name);
    }
  }
  appOwner = branch;
  return displaced;
}

/** Take down the whole process group, not just the shell becode spawned. */
function stop(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill();
  }
}

/** The pids becode started and still tracks, so a busy port can be told apart from a leftover. */
export function ownedPids(): number[] {
  return [...live.values()].map((entry) => entry.child.pid).filter((pid): pid is number => !!pid);
}

/**
 * Children are detached, so nothing else would ever stop them: a becode that exits without this
 * leaves a dev server holding :3002 that the next run cannot see, cannot kill, and cannot boot past.
 *
 * Services are included, unlike in the takeover. They are shared across *chats*, not across becode
 * processes — `pnpm dev:backend` runs forever and gets reparented to init on every restart, which
 * is how four of them ended up fighting over :3031. Killing an already-exited `docker compose up -d`
 * is a no-op and its containers are not becode's children, so real shared infrastructure is safe.
 */
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const entry of live.values()) stop(entry.child);
    if (signal !== "exit") process.exit(0);
  });
}

/** Still doing its job: running, or a one-shot (`docker compose up -d`) that exited clean. */
const isUp = (child: ChildProcess) =>
  child.signalCode === null && (child.exitCode === null || child.exitCode === 0);

/**
 * Whether the server is actually serving.
 *
 * The process alone is not enough: `shell: true` means becode holds `/bin/sh -c ...`, which
 * survives the dev server dying underneath it. So a declared port has to answer too — otherwise
 * the bar reports "running" at a port with nothing on it, which is the failure this whole thing
 * exists to surface. No port declared means the process is all there is to go on.
 */
const serverUp = async (server: Server) =>
  isUp(server.child) && (server.port === undefined || (await isListening(server.port)));

/**
 * becode's own environment, minus what a target's dev server must not inherit.
 *
 * `next dev` sets `process.env.PORT` to becode's own port (start-server.js), so a service that
 * reads `PORT` — every Nest app does — bound :4000 instead of the 3031 in its `.env`, and crashed
 * with EADDRINUSE against becode itself. Apps never hit it because they are given an explicit
 * PORT; services are given none, so they inherited it.
 *
 * `__NEXT_*` is the same bug with a nastier face. becode is a Next app, so loading its own
 * `.env.local` sets `__NEXT_PROCESSED_ENV=true` — and `@next/env` reads that as "someone already
 * applied the env", returning before it assigns anything. A target Next app inheriting it still
 * *lists* `.env.local` in its startup banner and still applies none of it, so the storefront booted
 * with `NEXT_PUBLIC_API_BASE` undefined, `apiBase()` threw inside every query, and the app made
 * zero requests to the backend with nothing in the console. tixvendor was fine because Vite reads
 * its own env. `NEXT_*` goes too: becode's own public vars would otherwise be inlined into a
 * target's bundle. Everything a target needs is in its own env files, which the worktree gets.
 *
 * The credentials go too — the Anthropic token and the Linear key alike. becode's credentials are
 * for becode; a target repo's dev server has no business being handed one just because it happens
 * to be a child process.
 */
export function childEnv(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  const inherited = { ...base };
  for (const key of ["PORT", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "LINEAR_API_KEY"]) {
    delete inherited[key];
  }
  for (const key of Object.keys(inherited)) {
    if (key.startsWith("BECODE_") || key.startsWith("NEXT_") || key.startsWith("__NEXT_")) {
      delete inherited[key];
    }
  }
  return { ...inherited, ...overrides };
}

function start(
  name: string,
  cwd: string,
  command: string,
  env: Record<string, string>,
  url: string | undefined,
  port: number | undefined,
  app: boolean,
) {
  // `detached` puts the app in its own process group. It has to: `shell: true` means the child is
  // `/bin/sh -c ...` and the dev server is its grandchild, so killing the child leaves the server
  // holding the port. Detaching is what makes `stop` able to take the whole group down — and it is
  // why the exit handler below exists, since a detached child would otherwise outlive becode.
  const child = spawn(command, { cwd, shell: true, env: childEnv(process.env, env), detached: true });
  child.unref();
  const logs = emptyBuffer();
  const capture = (buf: Buffer) => append(logs, buf.toString());
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const entry = { name, url, port, app, child, logs };
  live.set(name, entry);
  return entry;
}

/**
 * Boot a project's apps and the services they need, and report what is serving.
 *
 * Shared by `run_project` and the start button in the header (`POST /api/agent/run`) — booting is
 * not a product change, so it does not belong behind the policy judge, and the person asking to
 * look at their own app should not have to phrase it as a task.
 *
 * `worktree` is where the apps run: a task's worktree when there is one, the source checkout when
 * the person just wants to see the project. Services always run from the source checkout.
 */
export async function bootProject(
  project: Project,
  worktree: string,
  branch: string | undefined,
  install = false,
) {
  if (install && project.install) {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(project.install!, { cwd: worktree, shell: true, env: childEnv(process.env, {}) });
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`install failed (exit ${code})`))));
    });
  }

  // Anything that is not actually serving is cleared out first, so "already up" cannot mean
  // "its shell is alive". A `nest start --watch` whose server died leaves that shell running,
  // and skipping it here reported the backend as restarted while :3031 stayed empty.
  for (const [name, entry] of live) {
    if (await serverUp(entry)) continue;
    stop(entry.child);
    live.delete(name);
  }

  // The ports are the only contended resource — worktrees are cheap and already isolated.
  // ponytail: take the lock over rather than queue behind it. One person, one screen: they
  // asked to see *this* branch. Add waiting only if two people ever watch at once.
  const displaced = takeAppPorts(branch);
  const started: string[] = [];

  // Services run in the *source checkout*: fixed ports, shared across tasks, and they read
  // env files that only exist there. Starting a second copy would just fail to bind.
  for (const service of project.services ?? []) {
    if (live.has(service.name)) continue;
    // A declared port is also an address. Without this the bar showed the backend as "up" with
    // nothing to click — the one server whose logs you actually want is the one you cannot open.
    const url = service.port ? `http://localhost:${service.port}` : undefined;
    start(service.name, project.path, service.command, {}, url, service.port, false);
    started.push(service.name);
  }

  // Apps run in the worktree, on the branch being changed. ponytail: never restarted — every
  // dev server here hot-reloads. Restart becode if a config file (not a component) changes.
  const urls = appUrls(project);
  for (const [index, app] of project.apps.entries()) {
    const { port, url } = urls[index];
    if (live.has(app.name)) continue;
    start(app.name, worktree, app.command.replaceAll("$PORT", String(port)), { PORT: String(port) }, url, port, true);
    started.push(app.name);
  }

  // Give anything new a moment to bind or die, so a crash is reported now rather than as a
  // blank page. A cold pnpm monorepo start is slower than a warm one, hence the generous wait.
  if (started.length > 0) await new Promise((r) => setTimeout(r, 12_000));

  const report = await Promise.all(
    [...live.values()].map(async (s) => {
      const up = await serverUp(s);
      return {
        name: s.name,
        url: s.url,
        running: up,
        ...(up ? {} : { exitCode: s.child.exitCode, logs: tail(s.logs, 1200) }),
      };
    }),
  );

  const dead = report.filter((s) => !s.running);
  if (dead.some((s) => project.apps.some((a) => a.name === s.name))) {
    throw new Error(`Some apps failed to start:\n${JSON.stringify(dead, null, 2)}`);
  }

  // A dead *service* does not throw — `docker compose up -d` exiting 0 is healthy — but it
  // used to pass in silence, so the person was told everything was fine while the backend was
  // down. Now the agent is handed the fact and can say it.
  const brokenServices = dead.filter((s) => !project.apps.some((a) => a.name === s.name));

  return {
    branch,
    started,
    servers: report,
    ...(displaced ? { note: `Stopped the apps that were showing ${displaced} — tell the user.` } : {}),
    ...(brokenServices.length > 0
      ? {
          warning:
            `${brokenServices.map((s) => s.name).join(", ")} is not running. The app may look ` +
            `broken because of it. Call read_logs to find out why, and tell the user.`,
        }
      : {}),
  };
}

/** Stop everything becode has booted — what the header's stop button does. */
export function stopProject(): string[] {
  const stopped = [...live.keys()];
  for (const entry of live.values()) stop(entry.child);
  live.clear();
  appOwner = undefined;
  return stopped;
}

/**
 * What the UI's live indicator reads. The child processes are the source of truth, not a flag.
 *
 * Everything is reported, running or not. Filtering to the healthy ones made a crashed backend
 * *disappear* from the bar rather than show as broken — which is the opposite of what a status
 * indicator is for, and left the person with nothing to click.
 */
export async function liveStatus() {
  const servers = await Promise.all(
    [...live.values()].map(async (s) => ({
      name: s.name,
      url: s.url,
      running: await serverUp(s),
      exitCode: s.child.exitCode,
      pid: s.child.pid,
      app: s.app,
    })),
  );
  return { branch: servers.some((s) => s.app && s.running) ? appOwner : undefined, servers };
}

/** One server's output from a reader's cursor onward. Backs the log route's poll. */
export async function readServerLog(name: string, from: number) {
  const server = live.get(name);
  if (!server) return null;
  return {
    name,
    url: server.url,
    running: await serverUp(server),
    exitCode: server.child.exitCode,
    pid: server.child.pid,
    ...since(server.logs, from),
  };
}


/** Tool names as the model sees them, for the permission gate. */
export const TOOL = {
  startTask: "mcp__becode__start_task",
  runProject: "mcp__becode__run_project",
  openPullRequest: "mcp__becode__open_pull_request",
  proposeProject: "mcp__becode__propose_project",
} as const;
