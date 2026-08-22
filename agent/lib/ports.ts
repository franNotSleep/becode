/**
 * Who is sitting on a port, and getting them off it.
 *
 * `run_project` boots apps on fixed ports, so a leftover from an earlier becode run — or the
 * person's own `next dev` — makes the app fail with EADDRINUSE and no way forward. becode cannot
 * kill it blind: it may be something they care about. So it reports who is there and asks.
 *
 * `lsof` and `ps`, because becode is a local process on macOS and there is no portable way to do
 * this in Node. A machine without `lsof` degrades to "nothing is holding it", which is what the
 * behaviour was before this existed.
 */
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * `pgid` is what identifies a process as becode's.
 *
 * Apps are spawned detached through a shell, so what becode tracks is the shell's pid while the
 * thing actually holding the port is its grandchild — a different pid, same process group. Matching
 * on pid alone made becode offer to kill its own running apps.
 */
export type Holder = { pid: number; pgid: number; command: string };

/**
 * Is anything actually answering on this port?
 *
 * The process being alive is not the same thing. becode spawns through a shell, so what it holds
 * is `/bin/sh -c "pnpm dev:backend"` — that shell survives the server crashing underneath it, and
 * the status bar happily reported "running" while :3031 was empty. A connect settles it.
 *
 * ponytail: `net.connect`, not another lsof — this runs on every status poll.
 */
export async function isListening(port: number, timeoutMs = 300): Promise<boolean> {
  // Both families, because they are not interchangeable: vite binds `[::1]:3000` and nothing
  // answers on 127.0.0.1, while a Nest app on `*:3031` answers on either. Checking one only
  // reported a healthy vendor admin as down.
  const answers = await Promise.all(
    ["127.0.0.1", "::1"].map(
      (host) =>
        new Promise<boolean>((resolve) => {
          const socket = net.connect({ port, host });
          const settle = (answer: boolean) => {
            socket.destroy();
            resolve(answer);
          };
          socket.setTimeout(timeoutMs);
          socket.once("connect", () => settle(true));
          socket.once("timeout", () => settle(false));
          socket.once("error", () => settle(false));
        }),
    ),
  );
  return answers.some(Boolean);
}

/** Processes listening on a TCP port. Empty when the port is free, or when `lsof` is missing. */
export async function holders(port: number): Promise<Holder[]> {
  const { stdout } = await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).catch(
    () => ({ stdout: "" }),
  );
  const pids = [...new Set(stdout.split("\n").map((line) => Number(line.trim())).filter(Boolean))];

  return Promise.all(
    pids.map(async (pid) => {
      const { stdout } = await exec("ps", ["-o", "pgid=,command=", "-p", String(pid)]).catch(
        () => ({ stdout: "" }),
      );
      const [, pgid = "", command = ""] = /^\s*(\d+)\s+([\s\S]*)$/.exec(stdout.trim()) ?? [];
      return { pid, pgid: Number(pgid) || pid, command: command.trim() || "unknown" };
    }),
  );
}

/**
 * Stop those processes and wait for the port to actually come free.
 *
 * SIGTERM first — a dev server given the chance closes its socket cleanly. The wait matters:
 * returning before the socket is released just moves EADDRINUSE one line later.
 */
export async function release(port: number, pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    try {
      // Negative pid is the process group: apps are spawned through a shell, so killing the pid
      // alone can leave the real server behind. Falls back to the single process.
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await holders(port)).length === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
