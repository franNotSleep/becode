import { hasLinear, listTeams } from "@/agent/lib/linear.ts";

export const runtime = "nodejs";

/**
 * The Linear teams this workspace has, for the picker in a project's settings.
 *
 * No key configured is not an error — becode opens PRs without Linear, so the picker just has
 * nothing to offer and says so.
 */
export async function GET() {
  if (!hasLinear()) return Response.json({ teams: [] });
  try {
    return Response.json({ teams: await listTeams() });
  } catch (error) {
    return Response.json({ message: (error as Error).message }, { status: 502 });
  }
}
