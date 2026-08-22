import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { allProjects } from "@/agent/lib/db.ts";

// Reads the real filesystem, so it cannot be prerendered or cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOME = os.homedir();

/**
 * Directories the person can pick a repo from.
 *
 * A browser cannot hand over a filesystem path: `webkitdirectory` gives paths relative to the
 * chosen folder, and `showDirectoryPicker()` gives a handle with a bare name. Cursor can open the
 * OS dialog because it is a native app. becode is a page in front of a local Node process, so the
 * picker has to be served — which is better here anyway, since this can say which folders are git
 * repos and which are already projects.
 *
 * Names only, never contents, and confined to the home directory. Everything else about reading a
 * repo stays behind `agent/lib/reads.ts`; this is the UI, not the agent.
 */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("path") ?? HOME;
  const target = path.resolve(asked.startsWith("~") ? path.join(HOME, asked.slice(1)) : asked);

  if (target !== HOME && !target.startsWith(HOME + path.sep)) {
    return Response.json({ message: `Only folders under ${HOME} can be browsed.` }, { status: 400 });
  }

  const listing = await fs.readdir(target, { withFileTypes: true }).catch(() => null);
  if (!listing) return Response.json({ message: `${target} is not a folder.` }, { status: 404 });

  const taken = new Set(allProjects().map((project) => path.resolve(project.path)));
  const entries = await Promise.all(
    listing
      // Dotfolders and node_modules are never what someone is looking for, and there are thousands.
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map(async (entry) => {
        const full = path.join(target, entry.name);
        return {
          name: entry.name,
          path: full,
          isRepo: await fs.stat(path.join(full, ".git")).then(() => true, () => false),
          added: taken.has(full),
        };
      }),
  );

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return Response.json({
    path: target,
    parent: target === HOME ? null : path.dirname(target),
    isRepo: await fs.stat(path.join(target, ".git")).then(() => true, () => false),
    added: taken.has(target),
    entries,
  });
}
