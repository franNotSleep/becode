import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { projects } from "../../becode.projects.ts";
import { appUrls } from "../lib/projects.ts";
import { changedFiles, createWorktree, git } from "../lib/git.ts";
import { rolePolicy } from "../lib/roles.ts";
import { activeTask, findProject, resolveInWorktree, task } from "../lib/task.ts";
import { judgeRequest } from "./judge.ts";

const exec = promisify(execFile);

/** Everything a tool returns reaches the model as text. */
const reply = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

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
      projects: projects.map((p) => ({ id: p.id, baseBranch: p.baseBranch })),
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
    projectId: z.string().describe("Project id from list_projects."),
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
    const project = findProject(projectId);

    const existing = task.get();
    if (existing) {
      throw new Error(
        `This session is already working on ${existing.projectId} (${existing.branch}). ` +
          `Finish or abandon it first. Run parallel work in a separate session.`,
      );
    }

    const verdict = await judgeRequest(request);
    if (!verdict.allowed) {
      return reply({ started: false, refused: verdict.reason });
    }

    const { dir, branch } = await createWorktree({
      repo: project.path,
      projectId,
      taskId: slug,
      baseBranch: project.baseBranch,
    });

    task.update(() => ({ projectId, request, worktree: dir, branch }));

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

/**
 * Everything becode has booted for the current task, keyed by name.
 *
 * ponytail: an in-process map, not a supervisor. becode is one local process serving one
 * person; if it ever needs to survive a restart, move this to a pidfile in the worktree.
 */
const live = new Map<string, { name: string; url?: string; child: ChildProcess; logs: string[] }>();

/** Still doing its job: running, or a one-shot (`docker compose up -d`) that exited clean. */
const isUp = (child: ChildProcess) =>
  child.signalCode === null && (child.exitCode === null || child.exitCode === 0);

function start(name: string, cwd: string, command: string, env: Record<string, string>, url?: string) {
  const child = spawn(command, { cwd, shell: true, env: { ...process.env, ...env }, detached: false });
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
  const current = task.get();
  const servers = [...live.values()]
    .filter((s) => isUp(s.child))
    .map((s) => ({ name: s.name, url: s.url }));
  return { branch: current?.branch, servers };
}

const runProject = tool(
  "run_project",
  "Boot the current project's apps (and the services they need) and return a URL for each one. " +
    "Call this after making a change so the user can see it. Anything already running is left " +
    "alone — dev servers hot-reload, so a second call is cheap.",
  {
    install: z
      .boolean()
      .default(false)
      .describe("Run the install command first. Needed on a fresh worktree."),
  },
  async ({ install }) => {
    const { task: current, project } = activeTask();

    if (install && project.install) {
      await new Promise<void>((resolve, reject) => {
        const p = spawn(project.install!, { cwd: current.worktree, shell: true, env: process.env });
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`install failed (exit ${code})`))));
      });
    }

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

    return reply({ branch: current.branch, started, servers: report });
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
    const { task: current, project } = activeTask();
    const files = await changedFiles(current.worktree);

    await git(current.worktree, "commit", "-m", title, "-m", body);
    await git(current.worktree, "push", "--set-upstream", "origin", current.branch);

    const { stdout } = await exec(
      "gh",
      ["pr", "create", "--base", project.baseBranch, "--head", current.branch, "--title", title, "--body", body],
      { cwd: current.worktree },
    );

    const url = stdout.trim().split("\n").pop() ?? "";
    task.update(() => null);

    // The apps were serving this worktree. Left running, the next task would show its code.
    // Services are shared infrastructure — they stay up.
    for (const [name, entry] of live) {
      if (!entry.url) continue;
      entry.child.kill();
      live.delete(name);
    }
    return reply({ url, branch: current.branch, files });
  },
);

export const becodeTools = createSdkMcpServer({
  name: "becode",
  instructions:
    "becode's own tools. Everything else you need — reading, searching and editing the target " +
    "repo — is a built-in tool rooted at the task worktree.",
  tools: [listProjects, startTask, runProject, openPullRequest],
});

/** Tool names as the model sees them, for the permission gate. */
export const TOOL = {
  startTask: "mcp__becode__start_task",
  openPullRequest: "mcp__becode__open_pull_request",
} as const;
