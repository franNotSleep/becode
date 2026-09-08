/**
 * The public surface: what a person with no session can reach.
 *
 * node --experimental-strip-types agent/lib/gate.check.ts
 */
import assert from "node:assert/strict";
import {
  OPEN_PATHS,
  isOpenPath,
  isTrustedOrigin,
  needsOriginCheck,
  safeNext,
  trustedOrigins,
} from "./gate.ts";

// The two things that must be open, or signing in requires being signed in.
assert.equal(isOpenPath("/login"), true);
assert.equal(isOpenPath("/login/"), true);
assert.equal(isOpenPath("/api/auth"), true);
assert.equal(isOpenPath("/api/auth/sign-in/email-otp"), true);
assert.equal(isOpenPath("/api/auth/email-otp/send-verification-otp"), true);

// The proxy in front of the preview hosts asks this one, and needs its 401 rather than a redirect.
assert.equal(isOpenPath("/api/auth/gate"), true);

// Everything else. `/api/agent` is the one that matters: it runs the agent with a shell.
for (const closed of [
  "/",
  "/design/tix",
  "/api/agent",
  "/api/agent/approve",
  "/api/agent/run",
  "/api/sessions",
  "/api/projects/tix",
  "/api/folders",
  "/api/attachments/abc",
]) {
  assert.equal(isOpenPath(closed), false, `${closed} must need a session`);
}

// The prefix trap. A route named like an open one is not an open one — these are the paths a
// careless `startsWith` would hand over, and none of them exist yet, which is the point.
for (const lookalike of ["/loginfo", "/login-as", "/api/authorize", "/api/authz/token", "/apilogin"]) {
  assert.equal(isOpenPath(lookalike), false, `${lookalike} is not covered by an open prefix`);
}

// A path that merely contains an open prefix deeper in is not open either.
assert.equal(isOpenPath("/api/agent/login"), false);
assert.equal(isOpenPath("/design/api/auth"), false);

assert.equal(OPEN_PATHS.length, 2, "opening a third path is a decision, not a detail");

// --- the origin check -------------------------------------------------------------------------
// Sharing the cookie with the preview hosts made them same-site, so a script in a preview could
// otherwise POST a turn with the person's session attached.
assert.equal(needsOriginCheck("POST", "/api/agent"), true);
assert.equal(needsOriginCheck("post", "/api/agent"), true, "method is not case-sensitive");
assert.equal(needsOriginCheck("POST", "/api/agent/approve"), true, "gate 3 above all");
assert.equal(needsOriginCheck("DELETE", "/api/sessions/abc"), true);
assert.equal(needsOriginCheck("PATCH", "/api/projects/tix"), true);

// Safe methods change nothing, and better-auth checks its own origins on the paths it owns.
assert.equal(needsOriginCheck("GET", "/api/agent/status"), false);
assert.equal(needsOriginCheck("HEAD", "/api/sessions"), false);
assert.equal(needsOriginCheck("OPTIONS", "/api/agent"), false);
assert.equal(needsOriginCheck("POST", "/api/auth/sign-in/email-otp"), false);

// Pages are not the concern — a cross-site form post cannot reach one that matters.
assert.equal(needsOriginCheck("POST", "/login"), false);
assert.equal(needsOriginCheck("POST", "/design/tix"), false);

const trusted = ["https://becode.v3.tix.do"];
assert.equal(isTrustedOrigin("https://becode.v3.tix.do", trusted), true);
assert.equal(isTrustedOrigin("https://p3002.becode.v3.tix.do", trusted), false, "a preview is not becode");
assert.equal(isTrustedOrigin("https://becode.v3.tix.do.evil.com", trusted), false);
assert.equal(isTrustedOrigin(null, trusted), false, "a missing Origin is not a pass");
assert.equal(isTrustedOrigin("null", trusted), false, "nor a sandboxed iframe's literal null");

assert.deepEqual(
  trustedOrigins({ BETTER_AUTH_URL: "https://a.example/", BETTER_AUTH_TRUSTED_ORIGINS: "https://b.example, https://c.example" }),
  ["https://a.example", "https://b.example", "https://c.example"],
  "trailing slashes and spaces are trimmed, since an Origin header has neither",
);
assert.deepEqual(trustedOrigins({}), []);

// --- where sign-in may send you ---------------------------------------------------------------
assert.equal(safeNext("/design/tix"), "/design/tix");
assert.equal(safeNext("/?chat=abc"), "/?chat=abc");
assert.equal(safeNext(undefined), "/");
assert.equal(safeNext("https://evil.com"), "/", "an absolute URL is not a path");
assert.equal(safeNext("//evil.com"), "/", "the protocol-relative form");
assert.equal(safeNext("/\\evil.com"), "/", "a backslash is a path separator to a browser");
assert.equal(safeNext("/\\\\evil.com"), "/");
assert.equal(safeNext("/%2f%2fevil.com"), "/", "encoded separators too");
assert.equal(safeNext("/\u0009/evil.com"), "/", "and control characters");

console.log("gate: ok");
