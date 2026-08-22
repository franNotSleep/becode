import { liveStatus } from "@/agent/sdk/tools.ts";

// Reads live child processes; there is nothing here to prerender or cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(liveStatus());
}
