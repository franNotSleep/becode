/**
 * better-auth's own endpoints: request a code, exchange it for a session, sign out.
 *
 * This is the one route tree the proxy must never gate, or signing in would require being signed
 * in. `proxy.ts` exempts `/api/auth` by prefix for exactly that reason.
 *
 * The handler is a function rather than `auth.handler` so that nothing is constructed — and no
 * database opened — until a request actually arrives. See the note on `authInstance`.
 */
import { toNextJsHandler } from "better-auth/next-js";
import { authEnabled, authInstance } from "@/agent/lib/auth.ts";

export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler((request: Request) => {
  // An instance running open has no sign-in to offer, and saying so is better than a stack trace
  // from a half-configured auth instance.
  if (!authEnabled) {
    return Promise.resolve(
      Response.json({ message: "becode is running without authentication." }, { status: 404 }),
    );
  }
  return authInstance().handler(request);
});
