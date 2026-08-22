import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { addProject, allProjects, findProject } from "../lib/db.ts";
import { appUrls } from "../lib/projects.ts";
import { changedFiles, createWorktree, git } from "../lib/git.ts";
import { rolePolicy } from "../lib/roles.ts";
import { activeTask, type Chat, resolveInWorktree } from "../lib/task.ts";
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

      chat.task = { projectId: id, request, worktree: dir, branch };

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
          .array(z.object({ name: z.string(), command: z.string() }))
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

      if (install && project.install) {
        await new Promise<void>((resolve, reject) => {
          const p = spawn(project.install!, { cwd: current.worktree, shell: true, env: process.env });
          p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`install failed (exit ${code})`))));
        });
      }

      // The ports are the only contended resource — worktrees are cheap and already isolated.
      // ponytail: take the lock over rather than queue behind it. One person, one screen: they
      // asked to see *this* branch. Add waiting only if two people ever watch at once.
      const displaced = takeAppPorts(current.branch);
      const started: string[] = [];

      // Services run in the *source checkout*: fixed ports, shared across tasks, and they read
      // env files that only exist there. Starting a second copy would just fail to bind.
      for (const service of project.services ?? []) {
        const existing = live.get(service.name);
        if (existing && isUp(existing.child)) continue;
        start(service.name, project.path, service.command, {});
        started.push(service.name);
      }

      // Apps run in the worktree, on the branch being changed. ponytail: never restarted — every
      // dev server here hot-reloads. Restart becode if a config file (not a component) changes.
      const urls = appUrls(project);
      for (const [index, app] of project.apps.entries()) {
        const { port, url } = urls[index];
        const existing = live.get(app.name);
        if (existing && isUp(existing.child)) continue;
        start(app.name, current.worktree, app.command.replaceAll("$PORT", String(port)), { PORT: String(port) }, url);
        started.push(app.name);
      }

      // Give anything new a moment to bind or die, so a crash is reported now rather than as a
      // blank page. A cold pnpm monorepo start is slower than a warm one, hence the generous wait.
      if (started.length > 0) await new Promise((r) => setTimeout(r, 12_000));

      const report = [...live.values()].map((s) => ({
        name: s.name,
        url: s.url,
        running: isUp(s.child),
        ...(isUp(s.child) ? {} : { exitCode: s.child.exitCode, logs: s.logs.join("").slice(-1200) }),
      }));

      const dead = report.filter((s) => !s.running);
      if (dead.some((s) => project.apps.some((a) => a.name === s.name))) {
        throw new Error(`Some apps failed to start:\n${JSON.stringify(dead, null, 2)}`);
      }

      return reply({
        branch: current.branch,
        started,
        servers: report,
        ...(displaced ? { note: `Stopped the apps that were showing ${displaced} — tell the user.` } : {}),
      });
    },
  );

  const openPullRequest = tool(
    "open_pull_request",
    "Open a pull request with the work in the current task worktree. This is the only way a " +
      "change leaves becode. Call it once the user has looked at the running app and approved.",
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
      await git(current.worktree, "push", "--set-upstream", "origin", current.branch);

      const { stdout } = await exec(
        "gh",
        ["pr", "create", "--base", project.baseBranch, "--head", current.branch, "--title", title, "--body", body],
        { cwd: current.worktree },
      );

      const url = stdout.trim().split("\n").pop() ?? "";
      chat.task = null;

      // The apps were serving this worktree. Left running, the next task would show its code.
      // Only this chat's, though — another chat may have taken the ports since.
      takeAppPorts(undefined, current.branch);
      return reply({ url, branch: current.branch, files });
    },
  );

  return createSdkMcpServer({
    name: "becode",
    instructions:
      "becode's own tools. Everything else you need — reading, searching and editing the target " +
      "repo — is a built-in tool rooted at the task worktree.",
    tools: [listProjects, startTask, runProject, openPullRequest, proposeProject],
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
const live = new Map<string, { name: string; url?: string; child: ChildProcess; logs: string[] }>();
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
      if (!entry.url) continue;
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
 * Apps are detached, so nothing else would ever stop them: a becode that exits without this leaves
 * a dev server holding :3002 that the next run cannot see, cannot kill, and cannot boot past.
 * Services stay — they are shared infrastructure and every task needs them.
 */
for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    for (const entry of live.values()) if (entry.url) stop(entry.child);
    if (signal !== "exit") process.exit(0);
  });
}

/** Still doing its job: running, or a one-shot (`docker compose up -d`) that exited clean. */
const isUp = (child: ChildProcess) =>
  child.signalCode === null && (child.exitCode === null || child.exitCode === 0);

function start(name: string, cwd: string, command: string, env: Record<string, string>, url?: string) {
  // `detached` puts the app in its own process group. It has to: `shell: true` means the child is
  // `/bin/sh -c ...` and the dev server is its grandchild, so killing the child leaves the server
  // holding the port. Detaching is what makes `stop` able to take the whole group down — and it is
  // why the exit handler below exists, since a detached child would otherwise outlive becode.
  const child = spawn(command, { cwd, shell: true, env: { ...process.env, ...env }, detached: true });
  child.unref();
  const logs: string[] = [];
  const capture = (buf: Buffer) => {
    logs.push(buf.toString());
    if (logs.length > 40) logs.shift();
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
  const entry = { name, url, child, logs };
  live.set(name, entry);
  return entry;
}

/** What the UI's live indicator reads. The child processes are the source of truth, not a flag. */
export function liveStatus() {
  const servers = [...live.values()]
    .filter((s) => isUp(s.child))
    .map((s) => ({ name: s.name, url: s.url }));
  return { branch: servers.some((s) => s.url) ? appOwner : undefined, servers };
}

/** Tool names as the model sees them, for the permission gate. */
export const TOOL = {
  startTask: "mcp__becode__start_task",
  runProject: "mcp__becode__run_project",
  openPullRequest: "mcp__becode__open_pull_request",
  proposeProject: "mcp__becode__propose_project",
} as const;
