import path from "node:path";
import { projects } from "../../becode.projects.ts";
import type { Project } from "./projects.ts";

export type Task = {
  projectId: string;
  /** What the person actually asked for, as judged at start_task. Carried for the PR gate. */
  request: string;
  worktree: string;
  branch: string;
} | null;

let current: Task = null;

/**
 * The one task this process is working on.
 *
 * ponytail: a module singleton, not a store. becode is one local process serving one person, and
 * one task at a time. If a task ever needs to survive a restart mid-review, apps/tixqa/server/db.ts
 * is the precedent — node:sqlite, no dependency.
 */
export const task = {
  get: (): Task => current,
  update: (fn: (previous: Task) => Task): Task => {
    current = fn(current);
    return current;
  },
};

export function findProject(projectId: string): Project {
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    throw new Error(`Unknown project "${projectId}". Configured: ${projects.map((p) => p.id).join(", ")}`);
  }
  return project;
}

export function activeTask(): { task: NonNullable<Task>; project: Project } {
  const current = task.get();
  if (!current) throw new Error("No task started. Call start_task first.");
  return { task: current, project: findProject(current.projectId) };
}

/**
 * Resolve a repo-relative path inside the worktree.
 *
 * Trust boundary: the model supplies this path. Reject anything that escapes the worktree —
 * `..` and absolute paths never reach the filesystem.
 */
export function resolveInWorktree(worktree: string, relPath: string): string {
  const full = path.resolve(worktree, relPath);
  const root = path.resolve(worktree);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the worktree: ${relPath}`);
  }
  return full;
}
