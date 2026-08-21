import { defineTool } from "eve/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { activeTask, resolveInWorktree } from "../lib/task.ts";
import { judgeChange } from "../lib/policy.ts";

export default defineTool({
  description:
    "Replace a file's contents in the current project worktree. Pass the complete new file, " +
    "not a fragment. Each edit is checked against this becode's role policy before it is written.",
  inputSchema: z.object({
    path: z.string().describe("Repo-relative path."),
    content: z.string().describe("The complete new file contents."),
    intent: z
      .string()
      .describe(
        "One sentence: what this edit changes about the app, in terms a non-engineer would " +
          "recognise. Describe the actual effect, not the mechanics.",
      ),
  }),

  /**
   * The role policy decides, not the model doing the work. Returning "denied" means eve never
   * runs `execute`, and the model gets the reason back instead of the write.
   */
  approval: async ({ toolInput }) => {
    const input = toolInput as { path?: string; intent?: string } | undefined;
    if (!input?.path || !input.intent) {
      return { type: "denied", reason: "An edit must state its path and its intent." };
    }
    const verdict = await judgeChange(`Editing \`${input.path}\`.\nIntent: ${input.intent}`);
    return verdict.allowed
      ? "not-applicable"
      : { type: "denied", reason: `${verdict.reason} Tell the user this, and do not try another route.` };
  },

  async execute({ path: rel, content }) {
    const { task } = activeTask();
    const full = resolveInWorktree(task.worktree, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    return { written: rel, bytes: Buffer.byteLength(content) };
  },
});
