import { allProjects, findProject } from "@/agent/lib/db.ts";
import { git } from "@/agent/lib/git.ts";
import { designDocs, projectDesign } from "@/agent/lib/impeccable.ts";

// Reads the target checkout off the local filesystem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A project's design system, for the window's rest state.
 *
 * The same pair `/design/[project]` renders as a server component. It needs a route now because
 * the window is a client component inside the chat shell, and `impeccable.ts` reaches for
 * `node:fs` — importing it across that boundary would drag the filesystem into the bundle.
 *
 * `GET /api/sessions` already carries each project's `design`, but not `docs`: the sidebar shows a
 * summary and this shows the documents themselves.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!allProjects().some((p) => p.id === id)) {
    return Response.json({ message: `No project called "${id}".` }, { status: 404 });
  }

  const project = findProject(id);
  return Response.json({
    design: await projectDesign(project.path, (paths) =>
      git(project.path, "ls-files", "--", ...paths).then((out) => out.split("\n").filter(Boolean)),
    ),
    docs: designDocs(project.path),
  });
}
