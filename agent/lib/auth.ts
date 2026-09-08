/**
 * Who is allowed to drive becode.
 *
 * Passwordless, by design: an address at the company's own domain, a six-digit code in the inbox,
 * and that is the whole login. There is no password to choose, share, or leak — which matters
 * because the person this is built for is not an engineer, and the alternative was a shared
 * password in a chat message.
 *
 * The domain check is the actual gate. `emailOTP` will happily create an account for any address
 * it is given, so an unrestricted instance is an open door with extra steps; the hook below
 * refuses anything outside `BECODE_EMAIL_DOMAIN` *before* a code is ever generated. Filtering
 * inside `sendVerificationOTP` would look like it worked and simply never deliver — a silent
 * failure the person cannot tell from a slow inbox.
 *
 * The store is becode's own sqlite file. better-auth takes a `node:sqlite` handle directly, so
 * this adds no native module and nothing to the image; the tables sit beside `projects`, `chats`
 * and `messages` and are backed up by whatever backs those up.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { sendCode } from "./mail.ts";

const FILE = process.env.BECODE_DB ?? path.join(os.homedir(), ".becode", "becode.db");

/** The domain an address must end in. One company, one instance — see the module comment. */
export const EMAIL_DOMAIN = process.env.BECODE_EMAIL_DOMAIN ?? "tix.do";

/**
 * better-auth's own tables, written out rather than migrated by its CLI.
 *
 * The CLI wants to resolve this config from outside Next's module graph, and every import here
 * carries an explicit `.ts` extension — so it is one more thing to go wrong at deploy time for no
 * benefit. This is the same shape `db.ts` already uses for becode's tables: idempotent DDL on
 * first open. Keep it in step with better-auth's core schema when upgrading.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS user (
  id             TEXT PRIMARY KEY,
  name           TEXT    NOT NULL,
  email          TEXT    NOT NULL UNIQUE,
  emailVerified  INTEGER NOT NULL DEFAULT 0,
  image          TEXT,
  createdAt      TEXT    NOT NULL,
  updatedAt      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id        TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token     TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId    TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id                    TEXT PRIMARY KEY,
  accountId             TEXT NOT NULL,
  providerId            TEXT NOT NULL,
  userId                TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  accessToken           TEXT,
  refreshToken          TEXT,
  idToken               TEXT,
  accessTokenExpiresAt  TEXT,
  refreshTokenExpiresAt TEXT,
  scope                 TEXT,
  password              TEXT,
  createdAt             TEXT NOT NULL,
  updatedAt             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expiresAt  TEXT NOT NULL,
  createdAt  TEXT,
  updatedAt  TEXT
);

CREATE INDEX IF NOT EXISTS session_token ON session (token);
CREATE INDEX IF NOT EXISTS verification_identifier ON verification (identifier);`;

/**
 * A second handle on the same file as `db.ts`.
 *
 * WAL is not optional here: without it a sign-in writing a session row and a turn writing its
 * message rows are two writers on one file, and one of them gets SQLITE_BUSY. `busy_timeout` goes
 * on **first**, or the switch to WAL is itself the statement that fails — it wants a brief
 * exclusive lock, and `next build` collects page data in parallel workers that all open this at
 * once. That is not a hypothetical: it is what the first build of this file did.
 */
function store(): DatabaseSync {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const handle = new DatabaseSync(FILE);
  handle.exec("PRAGMA busy_timeout = 5000;");
  handle.exec("PRAGMA journal_mode = WAL;");
  handle.exec(SCHEMA);
  return handle;
}

/** `false` when no secret is configured — the app then runs open, exactly as it did before. */
export const authEnabled = Boolean(process.env.BETTER_AUTH_SECRET);

const allowed = (email: string) => email.toLowerCase().trim().endsWith(`@${EMAIL_DOMAIN}`);

/**
 * Built on first use, never at import.
 *
 * `db.ts` says the same thing about its own handle and it is the same reason twice over: a module
 * that opens a database when it is imported opens it during `next build` too, in every parallel
 * worker that touches a route referencing it. It also means an instance with no secret configured
 * constructs nothing at all rather than throwing on the default-secret guard.
 */
let instance: ReturnType<typeof build> | undefined;

export const authInstance = (): ReturnType<typeof build> => (instance ??= build());

function build() {
  return betterAuth({
    database: store(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // The reverse proxy terminates TLS, so the origin the browser used is in a header, not in the
    // socket. Without these an honest request looks cross-origin and is refused.
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),

    emailAndPassword: { enabled: false },

    advanced: {
      // One cookie for `becode.example.com` and every `p<port>.` preview under it, so a person signs
      // in once and the preview frames are covered by the same session — which is what lets the
      // proxy in front of those hosts ask becode whether to let the request through.
      //
      // sameSite stays `lax`: the previews share a registrable domain with becode, so the browser
      // already counts them as same-site and sends the cookie. `none` would be a downgrade bought
      // for nothing.
      crossSubDomainCookies: process.env.BECODE_COOKIE_DOMAIN
        ? { enabled: true, domain: process.env.BECODE_COOKIE_DOMAIN }
        : { enabled: false },
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 3,
        // A stolen database should not be a book of live codes.
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp }) => {
          await sendCode(email, otp);
        },
      }),
    ],

    hooks: {
      /**
       * The gate: no code is issued, and no session minted, for an address outside the domain.
       *
       * Be precise about what this covers, because the shape is default-*allow*. It checks a
       * top-level string `email` on the request body, which is every endpoint the current plugin
       * set exposes. A plugin added later that identifies someone by something else — a
       * magic-link token, an OAuth callback, an address nested a level down — would pass straight
       * through. Adding one means extending this; `emailAndPassword` is off, so there is no
       * second door today.
       */
      before: createAuthMiddleware(async (ctx) => {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string") return;
        if (allowed(email)) return;
        throw new APIError("FORBIDDEN", {
          message: `Only @${EMAIL_DOMAIN} addresses can sign in to becode.`,
        });
      }),
    },
  });
}

/** The signed-in person, or `undefined`. The only way to ask; nothing reads the cookie by hand. */
export async function sessionFor(headers: Headers) {
  if (!authEnabled) return undefined;
  const result = await authInstance()
    .api.getSession({ headers })
    .catch(() => null);
  return result ?? undefined;
}
