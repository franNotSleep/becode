import { defineTool } from "eve/tools";
import { z } from "zod";
import { spawn, type ChildProcess } from "node:child_process";
import { activeTask } from "../lib/task.ts";

/**
 * Live dev servers, keyed by worktree.
 *
 * ponytail: in-process map, not a supervisor. becode is one local process serving one
 * person; if it ever needs to survive a restart, move this to a pidfile in the worktree.
 */
const running = new Map<string, ChildProcess>();

function start(cwd: string, command: string, env: Record<string, string>): ChildProcess {
  const child = spawn(command, { cwd, shell: true, env: { ...process.env, ...env }, detached: false });
  child.unref();
  return child;
}

export default defineTool({
  description:
    "Boot the current project's dev server (and its services) in the task worktree, then " +
    "return the URL to look at. Call this after making a change so the user can see it. " +
    "Restarts the server if it is already running.",
  inputSchema: z.object({
    install: z.boolean().default(false).describe("Run the install command first. Needed on a fresh worktree."),
  }),
  async execute({ install }) {
    const { task, project } = activeTask();

    running.get(task.worktree)?.kill();
    running.delete(task.worktree);

    if (install && project.install) {
      await new Promise<void>((resolve, reject) => {
        const p = start(task.worktree, project.install!, {});
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`install failed (exit ${code})`))));
      });
    }

    for (const service of project.services ?? []) {
      start(task.worktree, service.command, {});
    }

    const child = start(task.worktree, project.dev.command, { PORT: String(task.port) });
    running.set(task.worktree, child);

    const logs: string[] = [];
    const capture = (buf: Buffer) => {
      logs.push(buf.toString());
      if (logs.length > 40) logs.shift();
    };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    // Give it a moment to bind or die, so a crash is reported now rather than as a blank page.
    await new Promise((r) => setTimeout(r, 4000));
    if (child.exitCode !== null) {
      throw new Error(`Dev server exited immediately (code ${child.exitCode}).\n${logs.join("")}`);
    }

    return {
      url: `http://localhost:${task.port}`,
      branch: task.branch,
      services: (project.services ?? []).map((s) => s.name),
      logs: logs.join("").slice(-2000),
    };
  },
});
