import { z } from "zod";
import { findProject, saveProject } from "@/agent/lib/db.ts";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/**
 * A project's boot recipe, edited by the person rather than the agent.
 *
 * `propose_project` can only ever *add* — `addProject` throws on a duplicate id, and its gate wants
 * the path to be a folder just picked in the browser. So a recipe the agent got slightly wrong (a
 * dev script that pins its own port, a service that moved) had no way back out except sqlite. This
 * is that way: `saveProject` had no caller outside `db.check.ts` until now.
 *
 * `id` and `path` are not editable and are taken from the stored row. Changing either is not an
 * edit — worktrees and chats are keyed on them, and a new repo is a new project.
 */
const Recipe = z.object({
  baseBranch: z.string().trim().min(1),
  install: z.string().trim().optional(),
  /** A Linear team key, or "" for none. Not validated against Linear — the picker only offers
   * teams the token can see, and a stale key surfaces as a warning on an open PR. */
  linearTeam: z.string().trim().optional(),
  apps: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        command: z.string().trim().min(1),
        port: z.number().int().min(1).max(65535),
      }),
    )
    .min(1),
  services: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        command: z.string().trim().min(1),
        port: z.number().int().min(1).max(65535).optional(),
      }),
    )
    .optional(),
});

/**
 * The refusal, in the language of the person reading it.
 *
 * zod's own text is `apps.0.port: Too small: expected number to be >=1`, which names an array
 * index and a bound to someone who is here because they do not read code. The row has a name;
 * use it. Anything unrecognised falls back to a sentence rather than a path.
 */
function explain(path: PropertyKey[], body: unknown): string {
  const [kind, index, field] = path as [string, number, string];
  const rows = (body as Record<string, { name?: string }[]> | null)?.[kind];
  const named = rows?.[index]?.name?.trim();
  const row = named ? `"${named}"` : `${kind === "apps" ? "App" : "Service"} ${index + 1}`;

  if (kind === "baseBranch") return "Name the branch work should start from.";
  if (kind === "apps" && index === undefined) {
    return "Keep at least one app — it is the page becode shows you.";
  }
  if (field === "name") return `Give ${kind === "apps" ? "app" : "service"} ${index + 1} a name.`;
  if (field === "command") return `${row} has no command to start it.`;
  if (field === "port") return `${row} needs a port number between 1 and 65535.`;
  return "Something in this recipe is not valid yet.";
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    return Response.json({ project: findProject(id) });
  } catch (error) {
    return Response.json({ message: (error as Error).message }, { status: 404 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;

  let stored;
  try {
    stored = findProject(id);
  } catch (error) {
    return Response.json({ message: (error as Error).message }, { status: 404 });
  }

  const body = await request.json();
  const parsed = Recipe.safeParse(body);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    return Response.json(
      { message: explain(issue.path, body), field: issue.path.join(".") },
      { status: 400 },
    );
  }

  // designSystem is not on the form; keep whatever the row already carries.
  saveProject({
    ...stored,
    ...parsed.data,
    install: parsed.data.install || undefined,
    linearTeam: parsed.data.linearTeam || undefined,
  });
  return Response.json({ ok: true });
}
