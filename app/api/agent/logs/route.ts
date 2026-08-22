import { readServerLog } from "@/agent/sdk/tools.ts";

// Reads buffers held against live child processes; there is nothing here to prerender or cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One server's output, from the reader's cursor onward.
 *
 * ponytail: a cursor poll rather than SSE. A person reading a log cannot tell a second from live,
 * the buffer already outlives both the modal and the process, and a poll needs no subscription to
 * clean up when the tab closes.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const name = params.get("name");
  if (!name) return Response.json({ message: "name is required" }, { status: 400 });

  const log = await readServerLog(name, Number(params.get("from") ?? 0));
  if (!log) return Response.json({ message: `Nothing called "${name}" is running.` }, { status: 404 });

  return Response.json(log);
}
