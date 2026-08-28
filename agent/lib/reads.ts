/**
 * What the agent may read, and from where.
 *
 * Split out of `canUseTool` so it can be checked without starting a session: this is a boundary,
 * and "the model did not try" is not evidence that it cannot. `agent/lib/reads.check.ts` drives
 * every branch directly.
 */
import path from "node:path";

import { resolveInWorktree } from "./task.ts";

export type ReadDecision = { allow: true } | { allow: false; message: string };

/**
 * Env files whose *values* are secrets. `.env.example`, `.env.sample` and `.env.template` are not:
 * they carry variable names with placeholders, which is all a boot recipe needs.
 */
const SECRET_ENV = /(^|\/)\.env($|\.(?!example$|sample$|template$))/;

/**
 * One root at a time: the task worktree, or — before a task exists — the single folder the person
 * picked to add as a project. The second is a real checkout rather than a disposable copy, so it
 * carries two extra rules that do not apply inside a worktree.
 */
export function canRead(
  chat: { task?: { worktree: string } | null; discoveryRoot?: string },
  toolName: string,
  target: unknown,
  /**
   * Where the CLI will resolve a relative path — the turn's working directory. It is the root on
   * every turn after `start_task`, which is why it defaults to one. On the `start_task` turn it is
   * the source checkout instead, and a relative path waved through as worktree-relative would be
   * read out of the person's real branch.
   */
  cwd?: string,
): ReadDecision {
  const worktree = chat.task?.worktree;
  const root = worktree ?? chat.discoveryRoot;
  if (!root) {
    return { allow: false, message: "There is no checkout to read yet. Call start_task first." };
  }

  // `Grep` prints matching *lines*, so a path rule cannot protect a secret from it — one search
  // for "PORT" would echo the real .env back. Discovery lists and reads; it does not search
  // contents. Inside a worktree Grep is how the agent finds anything, so there it stays.
  if (!worktree && toolName === "Grep") {
    return {
      allow: false,
      message:
        "Searching file contents is not available while looking at a repo to add. " +
        "Use Glob to find files and Read to open them.",
    };
  }

  // No path at all is `Glob`/`Grep` searching the working directory, which is exactly the case a
  // path rule used to miss: on a `start_task` turn that is the person's checkout, and Grep prints
  // matching lines. Resolving "" against cwd puts it through the same check as everything else.
  const asked = typeof target === "string" ? target : "";

  try {
    resolveInWorktree(root, path.resolve(cwd ?? root, asked));
  } catch {
    return {
      allow: false,
      message: `Only files inside ${root} can be read — use an absolute path under it.`,
    };
  }

  // Discovery is reading the person's real checkout — live keys and all. `createWorktree` copies
  // the real env files into every worktree anyway, so a boot command never needs the values.
  if (!worktree && SECRET_ENV.test(asked)) {
    return {
      allow: false,
      message:
        `${asked} holds live secrets and is not readable. Read .env.example for the variable ` +
        `names; the real env file is copied into every worktree automatically, so a boot command ` +
        `must never carry values inline.`,
    };
  }

  return { allow: true };
}
