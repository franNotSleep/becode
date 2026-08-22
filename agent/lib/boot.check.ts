/**
 * The boot path, checked without booting anything real: port math, liveness, and the one
 * thing `git worktree add` silently gets wrong — untracked env files.
 *
 * node --experimental-strip-types agent/lib/boot.check.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

process.env.BECODE_PORT_OFFSET = "10";
const { appUrls } = await import("./projects.ts");
const { copyLocalEnv } = await import("./git.ts");

// Ports: the base from config, plus this instance's offset, in the URL the person clicks.
assert.deepEqual(
  appUrls({
    id: "x",
    path: "/tmp",
    baseBranch: "main",
    apps: [{ name: "storefront", command: "dev -p $PORT", port: 3002 }],
  }),
  [{ name: "storefront", port: 3012, url: "http://localhost:3012" }],
);

// Liveness: running and clean-exit one-shots are up; a crash or a kill is not.
const isUp = (child: { signalCode: string | null; exitCode: number | null }) =>
  child.signalCode === null && (child.exitCode === null || child.exitCode === 0);
const done = (command: string) =>
  new Promise<{ signalCode: string | null; exitCode: number | null }>((resolve) => {
    const child = spawn(command, { shell: true });
    child.on("exit", () => resolve(child));
  });

assert.equal(isUp({ signalCode: null, exitCode: null }), true, "a running server is up");
assert.equal(isUp(await done("true")), true, "docker compose up -d exits 0 and is still up");
assert.equal(isUp(await done("exit 1")), false, "a crash is not up");
assert.equal(isUp({ signalCode: "SIGTERM", exitCode: null }), false, "a killed server is not up");

// Untracked env files: a worktree without them boots into a broken app.
const repo = await fs.mkdtemp(path.join(os.tmpdir(), "becode-check-"));
const worktree = path.join(repo, "..", `${path.basename(repo)}-wt`);
try {
  await exec("git", ["init", "-b", "main", repo]);
  await exec("git", ["-c", "user.email=c@c", "-c", "user.name=c", "commit", "--allow-empty", "-m", "root"], { cwd: repo });
  await fs.mkdir(path.join(repo, "apps", "api"), { recursive: true });
  await fs.writeFile(path.join(repo, ".gitignore"), ".env*\n");
  await fs.writeFile(path.join(repo, "apps", "api", ".env"), "PORT=3031\n");
  await exec("git", ["worktree", "add", "-b", "wt", worktree, "main"], { cwd: repo });

  assert.equal(
    await fs.access(path.join(worktree, "apps", "api", ".env")).then(() => true, () => false),
    false,
    "git worktree add does not copy ignored files — that is the whole problem",
  );
  await copyLocalEnv(repo, worktree);
  assert.equal(await fs.readFile(path.join(worktree, "apps", "api", ".env"), "utf8"), "PORT=3031\n");
} finally {
  await fs.rm(worktree, { recursive: true, force: true });
  await fs.rm(repo, { recursive: true, force: true });
}

console.log("boot check ok");
