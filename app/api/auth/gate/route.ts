/**
 * "Is this person signed in?" — 204 or 401, nothing else.
 *
 * It exists for the reverse proxy in front of the preview hosts. Those are dev servers becode
 * started; becode does not serve them and cannot put a session check inside them, so Caddy asks
 * this endpoint on every request (`forward_auth`) and serves the preview only on a 2xx.
 *
 * The browser sends becode's cookie to `p<port>.` hosts because the cookie's domain is the parent
 * (`BECODE_COOKIE_DOMAIN`), so the answer here is about the same session the main page uses.
 */
import { authEnabled, sessionFor } from "@/agent/lib/auth.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // Nothing configured means nothing to enforce — the instance is open, and refusing here would
  // lock the previews while leaving becode itself reachable, which helps no one.
  if (!authEnabled) return new Response(null, { status: 204 });

  const session = await sessionFor(request.headers);
  if (!session) return new Response(null, { status: 401 });

  // Handy for a proxy that wants to log who it let through.
  return new Response(null, { status: 204, headers: { "x-becode-user": session.user.email } });
}
