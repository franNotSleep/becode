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
import { promisify } from "node:util";

const exec = promisify(execFile);

export type Holder = { pid: number; command: string };

/** Processes listening on a TCP port. Empty when the port is free, or when `lsof` is missing. */
export async function holders(port: number): Promise<Holder[]> {
  const { stdout } = await exec("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).catch(
    () => ({ stdout: "" }),
  );
  const pids = [...new Set(stdout.split("\n").map((line) => Number(line.trim())).filter(Boolean))];

  return Promise.all(
    pids.map(async (pid) => {
      const { stdout: command } = await exec("ps", ["-o", "command=", "-p", String(pid)]).catch(
        () => ({ stdout: "" }),
      );
      return { pid, command: command.trim() || "unknown" };
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
