/**
 * The single gate in front of becode.
 *
 * This is `proxy.ts`, not `middleware.ts` — Next 16 renamed the convention, and the rename came
 * with the thing that makes this file worth having: **Proxy defaults to the Node.js runtime**, so
 * it can do a real session lookup against sqlite rather than the optimistic
 * "is there a cookie shaped like a session" check an edge runtime forces on you. A presence check
 * would be no gate at all here: `POST /api/agent` runs the agent with a shell, and forging the
 * *presence* of a cookie is not hard.
 *
 * One chokepoint rather than a `requireSession()` call at the top of fifteen route handlers,
 * because the sixteenth route is the one someone forgets. Same reasoning as `canUseTool`: default
 * deny, and name the exceptions.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authEnabled, sessionFor } from "@/agent/lib/auth.ts";
import { isOpenPath, isTrustedOrigin, needsOriginCheck, trustedOrigins } from "@/agent/lib/gate.ts";

export async function proxy(request: NextRequest) {
  // No secret configured, no enforcement — a laptop instance behaves exactly as it did before
  // any of this existed. The warning about that lives in `session.ts`, next to the judge's.
  if (!authEnabled) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Before anything else, and regardless of whether there is a session: a state-changing API call
  // has to come from becode's own page. The session cookie is deliberately shared with the
  // `p<port>.` preview hosts so the reverse proxy can gate them, and that makes those hosts
  // same-site — so without this, a script inside a preview can spend the person's session on
  // `POST /api/agent` and start a turn. See `needsOriginCheck`.
  if (needsOriginCheck(request.method, pathname)) {
    const allowed = trustedOrigins();
    if (allowed.length > 0 && !isTrustedOrigin(request.headers.get("origin"), allowed)) {
      return NextResponse.json({ message: "Request must come from becode itself." }, { status: 403 });
    }
  }

  if (isOpenPath(pathname)) return NextResponse.next();

  if (await sessionFor(request.headers)) return NextResponse.next();

  // An API caller gets a status it can act on; a person gets the page that fixes it. Answering a
  // fetch with a redirect to HTML is how you get "unexpected token < in JSON".
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "Sign in to use becode." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  // Come back to whatever they were opening — usually a chat link someone pasted them.
  if (pathname !== "/") login.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  /**
   * Everything except Next's own static output and the favicon. Without a matcher this runs on
   * every asset request, and a redirect on a stylesheet is how the login page arrives unstyled.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
