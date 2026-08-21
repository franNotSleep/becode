import { resolveApproval } from "@/agent/sdk/session.ts";

export const runtime = "nodejs";

/**
 * Gate 3's human half. `canUseTool` is parked on a promise waiting for this; resolving it is what
 * lets `open_pull_request` run — or not.
 */
export async function POST(request: Request) {
  const { id, approved } = (await request.json()) as { id?: unknown; approved?: unknown };

  if (typeof id !== "string") {
    return Response.json({ message: "id is required" }, { status: 400 });
  }

  const resolved = resolveApproval(id, approved === true);
  return Response.json({ resolved }, { status: resolved ? 200 : 404 });
}
