/**
 * Which paths are reachable without a session.
 *
 * This is the whole of becode's public surface, and it lives here rather than inline in `proxy.ts`
 * for the same reason the read rules live in `reads.ts`: it is a list that decides who can run the
 * agent, and a list like that should be drivable by a check rather than reasoned about.
 *
 * Default deny. Everything not named here needs a session, so a route added tomorrow is closed by
 * existing, and opening one is a visible edit to this file.
 */

/**
 * `/login` is the page that fixes a refusal, and `/api/auth` is how a code is requested and
 * exchanged — gating either would mean needing a session in order to get a session.
 *
 * `/api/auth/gate` sits under that prefix and answers 401 on its own. That is deliberate: it is
 * the endpoint the reverse proxy in front of the preview hosts asks, and it has to be able to say
 * "no" rather than be redirected to a login page the proxy cannot render.
 */
export const OPEN_PATHS = ["/login", "/api/auth"] as const;

/**
 * Prefix matching on segment boundaries only.
 *
 * `pathname.startsWith("/login")` alone would also open `/loginfo`, and `/api/auth` would open
 * `/api/authorize` — a route nobody has written yet, which is exactly when this kind of hole gets
 * made. A prefix counts only as a whole segment, or as the head of a deeper path.
 */
export const isOpenPath = (pathname: string): boolean =>
  OPEN_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * Requests that need the caller's origin checked.
 *
 * Sharing the session cookie with the `p<port>.` preview hosts is what lets the reverse proxy gate
 * them — and it is also what makes those hosts **same-site** with becode, which removes the
 * SameSite=Lax protection that was quietly guarding this API. A preview serves the target repo's
 * own dev server: application code becode is in the middle of editing. A script there can
 * `fetch(".../api/agent", { credentials: "include" })`, and CORS would stop it reading the reply
 * but not stop the turn from running.
 *
 * The usual answer — "JSON bodies force a CORS preflight" — does not hold here. Every route uses
 * `request.json()`, which parses bytes and never looks at `Content-Type`, so `text/plain` is a
 * simple request, sends no preflight, and is parsed happily on arrival.
 *
 * Safe methods are exempt because they change nothing, and `/api/auth` is exempt because
 * better-auth runs its own origin check on exactly these verbs.
 */
export const needsOriginCheck = (method: string, pathname: string): boolean =>
  !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) &&
  pathname.startsWith("/api/") &&
  !isOpenPath(pathname);

/**
 * Browsers send `Origin` on every state-changing request, same-origin ones included, so requiring
 * it costs a real caller nothing. A script driving becode with `curl` has to send one too — which
 * is the behaviour better-auth already has, so it is not a new rule to learn.
 */
export const isTrustedOrigin = (origin: string | null, trusted: readonly string[]): boolean =>
  Boolean(origin) && trusted.includes(origin as string);

/** The origins a request may claim, from the same env the auth instance is configured with. */
export const trustedOrigins = (
  env: Partial<Record<string, string>> = process.env,
): string[] =>
  [env.BETTER_AUTH_URL ?? "", ...(env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",")]
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

/**
 * Where `/login?next=…` may send someone after signing in.
 *
 * `startsWith("/") && !startsWith("//")` is the obvious guard and it is not enough: a browser
 * resolves `/\evil.com` with WHATWG parsing, where a backslash is a path separator for special
 * schemes, so it lands on `https://evil.com` with the sign-in fresh in hand. Same for encoded
 * separators and control characters, which is why this checks the shape rather than blocklisting.
 */
export const safeNext = (next: string | undefined): string => {
  if (!next || !next.startsWith("/")) return "/";
  if (/^\/[\\/]/.test(next)) return "/";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return "/";
  if (/%2f|%5c/i.test(next.split("?")[0] ?? "")) return "/";
  return next;
};
