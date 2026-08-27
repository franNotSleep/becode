import { resolveQuestion } from "@/agent/sdk/session.ts";

export const runtime = "nodejs";

/**
 * The person's half of `AskUserQuestion`.
 *
 * `onUserDialog` is parked on a promise waiting for this, exactly as gate 3's approval is. The
 * answers are keyed by the question's own text, which is what the CLI folds back into the tool's
 * input — so they must be sent back verbatim, not by index.
 */
export async function POST(request: Request) {
  const { id, answers } = (await request.json()) as { id?: unknown; answers?: unknown };

  if (typeof id !== "string") {
    return Response.json({ message: "id is required" }, { status: 400 });
  }

  // A null answer is a real outcome — it is how the person declines to pick, and it lets the CLI
  // fall back to its own default rather than leaving the turn parked until the dialog deadline.
  let chosen: Record<string, string> | null = null;
  if (answers !== null && typeof answers === "object" && !Array.isArray(answers)) {
    chosen = Object.fromEntries(
      Object.entries(answers as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
        .map(([question, value]) => [question, String(value)]),
    );
    if (Object.keys(chosen).length === 0) chosen = null;
  }

  const resolved = resolveQuestion(id, chosen);
  return Response.json({ resolved }, { status: resolved ? 200 : 404 });
}
