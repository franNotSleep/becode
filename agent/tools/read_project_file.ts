import { defineTool } from "eve/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import { activeTask, resolveInWorktree } from "../lib/task.ts";

export default defineTool({
  description:
    "Read a file from the current project worktree. Reading is unrestricted — understand the " +
    "codebase properly before changing it.",
  inputSchema: z.object({ path: z.string().describe("Repo-relative path.") }),
  async execute({ path: rel }) {
    const { task } = activeTask();
    return { content: await fs.readFile(resolveInWorktree(task.worktree, rel), "utf8") };
  },
});
