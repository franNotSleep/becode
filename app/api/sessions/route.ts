import { listSessions } from "@anthropic-ai/claude-agent-sdk";
import { allProjects } from "@/agent/lib/db.ts";

// Reads the SDK's session store off the local filesystem.
export const runtime = "nodejs";

/**
 * Past chats, grouped by project.
 *
 * There is no chats table. The Agent SDK already keeps every session on disk — the same store
 * `resume` reads — and `listSessions` groups by project directory, following git worktrees, which
 * is exactly how becode's tasks are laid out. A second copy would only be a second thing to
 * disagree with it.
 *
 * The `becode` tag is what separates these from the terminal sessions living in the same repo;
 * `session.ts` stamps it the first time a chat reports an id.
 */
export async function GET(request: Request) {
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 40);

  const groups = await Promise.all(
    allProjects().map(async (project) => {
      const sessions = await listSessions({ dir: project.path, limit }).catch(() => []);
      return {
        id: project.id,
        chats: sessions
          .filter((s) => s.tag === "becode")
          .map((s) => ({
            sessionId: s.sessionId,
            title: s.customTitle ?? s.summary,
            branch: s.gitBranch,
            lastModified: s.lastModified,
          })),
      };
    }),
  );

  return Response.json({ projects: groups });
}
