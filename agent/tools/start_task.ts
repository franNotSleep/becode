import { defineTool } from "eve/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import { createWorktree } from "../lib/git.ts";
import { judgeRequest } from "../lib/policy.ts";
import { findProject, task, resolveInWorktree } from "../lib/task.ts";

export default defineTool({
  description:
    "Start work on a project. First checks the user's request against this becode's role policy, " +
    "then creates an isolated git worktree on a fresh branch. Call this before touching anything. " +
    "If it comes back refused, tell the user why and stop — do not look for another way in.",
  inputSchema: z.object({
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
  }),
  async execute({ projectId, request, slug }) {
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
      return { started: false, refused: verdict.reason };
    }

    const { dir, branch } = await createWorktree({
      repo: project.path,
      projectId,
      taskId: slug,
      baseBranch: project.baseBranch,
    });

    // Offset the port per task so concurrent sessions don't collide.
    const port = project.dev.port + (slug.length % 20) * 10;
    task.update(() => ({ projectId, request, worktree: dir, branch, port }));

    const designSystem = await Promise.all(
      (project.designSystem ?? []).map(async (rel) => {
        const stat = await fs.stat(resolveInWorktree(dir, rel)).catch(() => null);
        return { path: rel, exists: stat !== null, isDirectory: stat?.isDirectory() ?? false };
      }),
    );

    return {
      started: true,
      branch,
      designSystem,
      next: designSystem.length
        ? "Read the design system files before making any visual change."
        : "No design system configured for this project.",
    };
  },
});
