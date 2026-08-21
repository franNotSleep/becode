import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const exec = promisify(execFile);

/** Where becode keeps its worktrees. One per task, never shared. */
export const WORKTREE_ROOT = path.join(os.homedir(), ".becode", "worktrees");

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

export async function defaultBranch(repo: string): Promise<string> {
  const ref = await git(repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD").catch(() => "");
  return ref ? ref.replace("refs/remotes/origin/", "") : "main";
}

/**
 * A fresh worktree on a new branch off the latest base. Isolated by construction:
 * two tasks can never share a working tree, which is what makes parallel work safe.
 */
export async function createWorktree(opts: {
  repo: string;
  projectId: string;
  taskId: string;
  baseBranch: string;
}): Promise<{ dir: string; branch: string }> {
  const branch = `becode/${opts.taskId}`;
  const dir = path.join(WORKTREE_ROOT, opts.projectId, opts.taskId);

  await git(opts.repo, "fetch", "origin", opts.baseBranch).catch(() => {
    // Offline or no remote — fall back to the local base branch.
  });
  const base = await git(opts.repo, "rev-parse", "--verify", `origin/${opts.baseBranch}`).catch(() =>
    git(opts.repo, "rev-parse", "--verify", opts.baseBranch),
  );

  await git(opts.repo, "worktree", "add", "-b", branch, dir, base);
  return { dir, branch };
}

export async function removeWorktree(repo: string, dir: string): Promise<void> {
  await git(repo, "worktree", "remove", "--force", dir);
}

/**
 * Repo-relative paths of every file changed in the worktree, including new ones.
 *
 * Stages first so untracked files are visible, and disables rename detection so a file
 * moved out of scope shows up as both a delete and an add rather than one in-scope path.
 */
export async function changedFiles(dir: string): Promise<string[]> {
  await git(dir, "add", "-A");
  const out = await git(dir, "diff", "--cached", "--name-only", "--no-renames", "-z");
  return out.split("\0").filter(Boolean);
}

export async function diff(dir: string): Promise<string> {
  await git(dir, "add", "-A");
  return git(dir, "diff", "--cached", "--stat");
}
