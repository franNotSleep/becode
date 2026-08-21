import { defineTool } from "eve/tools";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { git, changedFiles, diff } from "../lib/git.ts";
import { judgeChange } from "../lib/policy.ts";
import { activeTask, task } from "../lib/task.ts";

const exec = promisify(execFile);

export default defineTool({
  description:
    "Open a pull request with the work in the current task worktree. This is the only way a " +
    "change leaves becode. Call it once the user has looked at the running app and approved.",
  inputSchema: z.object({
    title: z.string().describe("PR title, in the user's words, not a commit-message summary."),
    body: z.string().describe("What changed and why, for a reviewer who did not see the conversation."),
  }),

  /**
   * The last gate, and the one that matters: it judges what actually changed on disk rather
   * than what anyone said they were doing. Nothing leaves this machine without passing it.
   */
  approval: async () => {
    const { task: current, project } = activeTask();

    if (current.branch === project.baseBranch) {
      return { type: "denied", reason: `Refusing to push to the base branch ${project.baseBranch}.` };
    }

    const files = await changedFiles(current.worktree);
    if (files.length === 0) {
      return { type: "denied", reason: "Nothing changed in this worktree — there is no PR to open." };
    }

    const verdict = await judgeChange(
      `Originally asked for: ${current.request}\n\nFiles changed:\n${files.join("\n")}\n\n` +
        `Diff summary:\n${await diff(current.worktree)}`,
    );
    if (!verdict.allowed) {
      return {
        type: "denied",
        reason:
          `${verdict.reason} The change stays in the worktree and does not become a pull request. ` +
          `Tell the user what happened.`,
      };
    }

    // Passed the policy; a person still confirms the outward-facing action.
    return "user-approval";
  },

  async execute({ title, body }) {
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
    return { url, branch: current.branch, files };
  },
});
