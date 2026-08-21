import { defineTool } from "eve/tools";
import { z } from "zod";
import fs from "node:fs";
import { activeTask } from "../lib/task.ts";

export default defineTool({
  description: "Find files in the current project worktree by glob.",
  inputSchema: z.object({
    pattern: z.string().describe("Repo-relative glob, e.g. 'src/components/**/*.tsx'."),
  }),
  execute({ pattern }) {
    const { task } = activeTask();
    return fs
      .globSync(pattern, {
        cwd: task.worktree,
        exclude: (p) => p.includes("node_modules") || p.includes(".git"),
      })
      .slice(0, 500);
  },
});
