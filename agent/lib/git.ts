import { execFile } from "node:child_process";
import fs from "node:fs/promises";
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
  // Two chats can be open on one project, and the model picks the slug from the request — so the
  // same name twice is normal now, and `worktree add -b` fails outright on a branch that exists.
  const { branch, dir } = await freeName(opts.projectId, opts.taskId);

  await git(opts.repo, "fetch", "origin", opts.baseBranch).catch(() => {
    // Offline or no remote — fall back to the local base branch.
  });
  const base = await git(opts.repo, "rev-parse", "--verify", `origin/${opts.baseBranch}`).catch(() =>
    git(opts.repo, "rev-parse", "--verify", opts.baseBranch),
  );

  await git(opts.repo, "worktree", "add", "-b", branch, dir, base);
  await copyLocalEnv(opts.repo, dir);
  return { dir, branch };
}

/**
 * Fast-forward the source checkout to the latest `origin/<baseBranch>`, or say why not.
 *
 * This is the person's real checkout, so it only ever moves forward: another branch checked out,
 * uncommitted work, or a branch that has diverged is left exactly as it is. It never throws —
 * being offline is no reason to refuse to show them their app.
 */
export async function pullLatest(repo: string, baseBranch: string): Promise<string> {
  try {
    const branch = await git(repo, "rev-parse", "--abbrev-ref", "HEAD");
    if (branch !== baseBranch) return `skipped: the checkout is on ${branch}, not ${baseBranch}`;
    if (await git(repo, "status", "--porcelain")) return "skipped: the checkout has uncommitted changes";

    const before = await git(repo, "rev-parse", "HEAD");
    await git(repo, "pull", "--ff-only", "origin", baseBranch);
    return (await git(repo, "rev-parse", "HEAD")) === before ? "up to date" : "pulled";
  } catch (error) {
    return `skipped: ${(error as Error).message.split("\n")[0]}`;
  }
}

/** The first `<slug>`, `<slug>-2`, `<slug>-3`… whose worktree directory is not taken. */
async function freeName(projectId: string, taskId: string): Promise<{ branch: string; dir: string }> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? taskId : `${taskId}-${n}`;
    const dir = path.join(WORKTREE_ROOT, projectId, name);
    const taken = await fs.stat(dir).then(() => true, () => false);
    if (!taken) return { branch: `becode/${name}`, dir };
  }
}

/**
 * Copy the source checkout's gitignored env files into a fresh worktree.
 *
 * `git worktree add` brings tracked files only, so a repo whose dev servers read a gitignored
 * `.env` boots into a broken app — the exact thing the person is about to look at. Same machine,
 * same repo, so this moves no secret anywhere it was not already.
 */
export async function copyLocalEnv(repo: string, dir: string): Promise<void> {
  const listed = await git(
    repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", "*.env", "*.env.*",
  );
  await Promise.all(
    listed.split("\0").filter(Boolean).map(async (rel) => {
      await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await fs.copyFile(path.join(repo, rel), path.join(dir, rel));
    }),
  );
}

/**
 * Whether `branch` still exists on origin.
 *
 * A continued chat is based on its parent's *pushed* branch. Once the parent merges and GitHub
 * deletes it, the base branch already holds that work, so callers fall back to it.
 */
export async function remoteHasBranch(repo: string, branch: string): Promise<boolean> {
  return git(repo, "ls-remote", "--exit-code", "--heads", "origin", branch).then(
    () => true,
    () => false,
  );
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
  // Content, not just names: gate 3 judges what actually changed, and a --stat summary cannot
  // show that a "spacing tweak" edited a number. Capped so a large change still fits a prompt.
  const out = await git(dir, "diff", "--cached", "-U2");
  return out.length > 60_000 ? `${out.slice(0, 60_000)}\n\n[diff truncated]` : out;
}
