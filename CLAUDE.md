# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

`becode` is a **locally-run agent** that lets a non-engineer (the Tix/Duomir CEO) file a task in
plain language, have it implemented against a real product repo, **see it running locally**, and
get a pull request out of it.

The loop it exists to serve:

1. CEO describes a change ("make the ticket card less cramped").
2. Agent checks out the target repo into an isolated worktree.
3. Agent boots that project's dev server + its dependencies (db, queues, whatever the repo needs).
4. Agent makes the change, within what the role policy allows.
5. CEO looks at the running app and says yes or no.
6. On yes → a PR. Never a direct push to a deploy branch.

## Invariants

These are the point of the project. Do not relax them for convenience.

- **No production writes, ever.** The agent's only output path to a target repo is a pull request
  against a non-default branch. No `git push` to `main`/`production`, no deploys, no force-push.
- **The role policy binds.** One instance, one role, one plain-English policy in `roles/`. Enforce
  it at the tool layer (deny the call), never in the prompt — prompts are not a boundary.
- **Design system is input, not invention.** Before changing UI, the agent reads the target repo's
  design system (tokens, theme config, component library) and works from it. New one-off colors,
  spacings, or components are a bug.
- **Target-repo-agnostic.** Nothing may hardcode Tix. Project setup is discovered from the target
  repo (package manager, scripts, compose/env files) or declared in per-project config.
- **Parallel tasks are isolated.** Concurrent tasks get separate git worktrees and separate ports.
  Two tasks must never share a working tree.

## Stack

**One Next.js project, one process.** The agent runs inside a route handler (`app/api/agent/`)
and streams NDJSON back to the browser. There is no second server: custom HTTP belongs in route
handlers, and agent capability belongs in `agent/sdk/tools.ts`. `apps/tixqa` in the tixdo/web
monorepo is the same architecture on Express — a useful reference, not a template.

- Next.js 16 (preview) · React 19 · Tailwind 4 · shadcn/ui in `components/ui/`
- `@anthropic-ai/claude-agent-sdk` — Claude Code as a library. It supplies the agent loop, context
  management, and host-native built-in tools; you supply the harness and host it yourself.
- Node 24 (`.nvmrc`; `nvm use` before anything). No Docker, no sandbox, no container.
- **Auth is your Claude subscription**, not an API key: `claude setup-token` mints a
  `CLAUDE_CODE_OAUTH_TOKEN` that covers both the agent and the judge.

## Layout

Tools are registered explicitly in `agent/sdk/tools.ts`. Skills are the exception — `agent/` is
loaded as a local **plugin**, so anything under `agent/skills/<name>/SKILL.md` is auto-discovered
and namespaced `becode:<name>`. If a skill "isn't being picked up", check the `plugins` and
`skills` lists on the init message before debugging anything else.

| Concern | Where |
| --- | --- |
| **Role policies, in plain English (the thing you edit)** | `roles/<role>.md` |
| **Which role this instance runs as** | `becode.config.ts` |
| Policy check harness | `roles/check.ts` (`npm run check:policy`) |
| The judge | `agent/sdk/judge.ts`, `agent/lib/roles.ts` |
| Target repos and how to boot them | `becode.projects.ts`, `agent/lib/projects.ts` |
| Active task, worktree path boundary | `agent/lib/task.ts` |
| git worktree / diff helpers | `agent/lib/git.ts` |
| becode's own tools | `agent/sdk/tools.ts` (one SDK MCP server, `mcp__becode__*`) |
| **The agent loop and all three gates** | `agent/sdk/session.ts` |
| Always-on system prompt | `agent/instructions.md` |
| HTTP surface | `app/api/agent/route.ts`, `approve/route.ts`, `status/route.ts` |
| CEO-facing UI | `app/_components/` (`agent-chat.tsx`, `use-becode-agent.ts`) |
| Is it live, and at which URLs | `app/_components/live-status.tsx` ← `GET /api/agent/status` |

## Booting the target project

A project declares two lists, and the split is the whole design:

- **`apps`** — the surfaces a person looks at. One URL each, started **in the task worktree** so
  they serve the branch being changed. `$PORT` is substituted from the app's base port plus
  `BECODE_PORT_OFFSET` (0 unless a second becode instance is running on this machine — offsetting
  by default would silently break CORS against a backend that allowlists the real ports).
- **`services`** — db, queue, api. Started **in the source checkout**, not the worktree: they sit
  on fixed host ports, they are shared across tasks, and a second copy would just fail to bind.

`run_project` starts only what is not already up, so calling it again after an edit is free — every
dev server here hot-reloads. Liveness is read off the child processes, never a flag: a one-shot like
`docker compose up -d` counts as up when it exits 0, a crash or a kill does not. The apps are killed
when a task ends, or the next task would be looking at the previous worktree's code.

`git worktree add` copies tracked files only, so `createWorktree` also copies the source checkout's
gitignored `.env*` files across. Without them the worktree boots into a broken app — which is
exactly the thing the person is about to look at.

## How the constraint works

One becode instance runs for **one person in one role**. `becode.config.ts` names the role;
`roles/<role>.md` is that role's policy, written in plain English by whoever installs it. Nothing
about the policy is structured — no globs, no path lists — and the agent doing the work never
gets to interpret it. A separate small model (`haiku`, set in `becode.config.ts`) rules on each
case against the policy text, defaulting to refusal when unsure — including when its own reply is
unparseable (`parseVerdict` in `agent/sdk/judge.ts`).

The built-in tools are **host-native**: `Read`, `Glob`, `Grep`, `Edit` and `Write` act on the real
checkout. `Bash` is removed outright with `disallowedTools`, which strips the tool definition from
the request — the model never sees it. So is `Task`, so there are no subagents with their own
permission surface to reason about.

Every path, read or write, goes through `resolveInWorktree` in `canUseTool`. `cwd` alone is not a
boundary: it is fixed when the query starts, so on the turn that calls `start_task` there is no
worktree yet — and an absolute path ignores `cwd` entirely. Without the check, `Read` would reach
becode's own `.env.local`. The model declining to do that is not a boundary either.

All three gates live in **one `canUseTool` callback** (`agent/sdk/session.ts`):

1. `start_task` — judges **the request**, before any work starts. Fast, honest refusal.
2. `Edit` / `Write` — judges **the actual change**: the path, plus the before/after text, before
   anything reaches disk. A `{behavior:"deny"}` means the write never happens and the model gets
   the reason instead.
3. `open_pull_request` — judges **the real diff** against the original request, then blocks on a
   person. `canUseTool` is async, so human confirmation is just an awaited promise resolved by
   `app/api/agent/approve/`.

Gate 1 still depends on the agent restating the request honestly. Gates 2 and 3 do not: both read
what is actually about to happen. Gate 3 is the boundary — nothing leaves the machine without it,
and the worktree is disposable if it fails.

**Do not add `allowedTools` or a `permissionMode`.** Auto-approved tools never reach `canUseTool`,
so either one would silently bypass the policy for the tools it covers. Narrow the surface with
`disallowedTools` only. If that ever changes, move the judge to a `PreToolUse` hook: hooks run
before every other step and a hook deny holds even under `bypassPermissions`.

## Skills

Two sets, different audiences. Both are committed, so a clone gets them.

**`.claude/skills/`** — for Claude Code working *on* this repo:

| Skill | For |
| --- | --- |
| `beui` | Maps UI intent to `@beui` shadcn install slugs |
| `high-end-visual-design` | Craft standards: type, spacing, shadow, motion |
| `redesign-existing-projects` | Audit-first upgrade of existing UI |
| `minimalist-ui` | Editorial/utilitarian direction |
| `improve-codebase-architecture` | Structural refactoring |

`design-taste-frontend` is **not** here: it self-scopes to "landing pages, portfolios, and
redesigns — not dashboards, not data tables, not multi-step product UI," and becode's own
interface is product UI. It *is* in `agent/skills/`, where target-repo marketing pages fall
squarely inside its scope. Still available to Claude Code at user level.

**`agent/skills/`** — loaded on demand by the becode agent at runtime, when it works on a *target*
repo. They reach it through the plugin at `agent/` (`agent/.claude-plugin/plugin.json`), because
the agent's `cwd` is the target worktree and a project-local `.claude/` would be the wrong repo's.
There are 4:

| Skill | For |
| --- | --- |
| `design-system-first` | **becode-authored.** Read the target's design system, reuse before inventing, change only what was asked |
| `design-taste-frontend` | Landing pages, portfolios, marketing surfaces — the marketing role's actual territory |
| `high-end-visual-design` | Craft standards |
| `redesign-existing-projects` | Audit-first, framework-agnostic |

One caveat on `design-taste-frontend` here: parts of it assume a shell (`npx shadcn@latest add`)
and image generation. becode has neither — `Bash` is removed from the tool surface entirely. It
can still author component files by hand; it cannot run the installer.

`design-system-first` exists because the off-the-shelf skills actively conflict with the brief
inside someone else's codebase — they say things like "replace the font with one that has
character" and "pick one accent colour, remove the rest." That is right for a greenfield page and
wrong for a marketing manager's "make the headline bigger." It establishes the precedence (project
system wins, general taste applies only where the project has not decided) and carves out the one
exception: accessibility defects get fixed. `agent/instructions.md` requires loading it first.

Skill routing is the `description` frontmatter — that is all the model sees until it opens one.
Write descriptions as "when to use this," not "what this is."

## UI

becode's own interface is built from **beUI** (`@beui`), a shadcn registry of animated React
components — registered in `components.json`, so `npx shadcn@latest add @beui/<slug>` works. There
is no `beui` runtime package; components are copied into `components/`. Fetch
<https://beui.dev/r/registry.json> for the live list. The `beui` MCP server is in local config
(`~/.claude.json`), not the repo — a teammate runs `claude mcp add` themselves.

The original scaffold's `components/ai-elements/` is **gone**. beUI's agent family replaced it:

| Was | Now |
| --- | --- |
| `conversation` | `@/components/agents/message-scroller` |
| `message` | `@/components/agents/message` |
| `prompt-input` | `@/components/agents/prompt-input` |
| `shimmer` | `@/components/agents/loading-states/thinking-shimmer` |
| `reasoning`, `chain-of-thought` | `@/components/agents/agent-activity` |
| `tool` | `@/components/agents/tool-result` + `tool-approval` |

Two notes:

- **Markdown.** beUI's `Message` is a layout primitive with no markdown renderer, so agent text
  still goes through `streamdown` (a local `Markdown` memo in `agent-message.tsx`).
- **Attachments.** beUI's `PromptInput` submits `(value, model?)` — no file parts, and `send()`
  takes text only. `@beui/attachment-upload` is the way back if pasting a reference image matters.
- **`approval-card` is unused.** It rendered eve's `ask_question`; `AskUserQuestion` is in
  `disallowedTools` because in a chat the agent can simply ask in a message. `tool-approval` is
  what gate 3 renders.

`components/motion/text-shimmer.tsx` carries a **local fix**: the registry ships it importing its
own constants from itself, which does not compile. It should come from `@/lib/text-shimmer`.
Re-running `shadcn add` for anything depending on it will reintroduce the break.

## Running it

```bash
nvm use                      # Node 24 — .nvmrc; the SDK requires >=24
claude setup-token           # mints a long-lived subscription token
cp .env.example .env.local   # then paste it as CLAUDE_CODE_OAUTH_TOKEN
npm install                  # first time only
npm run dev                  # http://localhost:4000
```

`npm run dev` is the whole app: Next.js serves the UI, and `POST /api/agent` runs the agent in a
Node route handler, streaming NDJSON back. There is no second process and no daemon.

becode itself sits on **:4000**, not :3000, because :3000 belongs to a target app (tixvendor).
Target apps keep their native ports: their env files and the backend's CORS allowlist are
already written for them, and moving becode is a one-line change while moving them is not.

Without a credential the UI loads and the first message comes back as a plain error naming the
fix — `hasAuth()` in `agent/sdk/session.ts` checks before anything else runs. `ANTHROPIC_API_KEY`
works too if you would rather be billed per token.

No Docker, no container, no keychain prompt. becode edits a local checkout with host-native tools;
there is nothing to virtualize.

## Commands

```bash
npm run typecheck            # tsc --noEmit
npm run check:policy         # the role policy against 10 known allow/refuse cases — run this first
npm run check:boot           # port math, liveness, and the env-file copy — no servers started
npm run build                # next build
npm run dev                  # the app
claude setup-token           # re-mint the subscription token when it expires
```

`check:policy` is the cheapest end-to-end signal in the repo: it exercises the token, the judge,
and the role policy in one command without touching the UI. Run it before debugging anything else.

`next dev` rewrites `AGENTS.md` and `next-env.d.ts` on every run; commit the churn rather than
fighting it. Next.js 16 is a preview with breaking changes — its own generated note points at
`node_modules/next/dist/docs/` rather than training data.

## Agent SDK facts this design leans on

Verified against <https://code.claude.com/docs/en/agent-sdk> and the installed
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. When the docs and the `.d.ts` disagree,
the `.d.ts` is what ships. Do not infer this API from other agent frameworks.

- **Auto-approved tools never reach `canUseTool`.** This is the single most important fact here —
  see the warning under How the constraint works.
- **`disallowedTools: ["Bash"]`** removes the tool definition entirely; a scoped rule like
  `Bash(rm *)` only blocks matching calls. Deny rules beat every permission mode.
- **`canUseTool` is async** and receives `toolUseID`, which is what makes an awaited human
  approval possible without inventing a protocol.
- **`PreToolUse` hooks run before everything** and can deny even under `bypassPermissions`. Not
  used today — `canUseTool` is authoritative while no allow rules exist — but it is the upgrade
  path if that ever stops being true.
- **Plugins load by local path** (`{type:"local", path}`) and the manifest is optional; skills are
  auto-discovered from `<plugin>/skills/<name>/SKILL.md` and namespaced `<plugin>:<skill>`.
- **`resume`** continues a session by id; the id arrives on the `system` init message.
- **The SDK bundles a native Claude Code binary** per platform as an optional dependency.
  `npm ci --omit=optional` would skip it and leave the SDK with nothing to run.

## Open decisions

- **Auth for the browser.** `POST /api/agent` is unauthenticated — anyone who can reach the port
  can drive the agent. Fine on localhost; must be fixed before it is reachable by anyone else.
- **Token expiry.** `CLAUDE_CODE_OAUTH_TOKEN` is long-lived, not eternal. `hasAuth()` catches
  absence; expiry surfaces as a run-time error from the SDK. Re-run `claude setup-token`.
- **Judge latency.** Every edit costs a judge call. If it drags, cache verdicts per (path, change)
  within a task, or drop gate 2 and rely on gates 1 and 3 — gate 3 is the boundary either way.
- **Parallel tasks.** One task per process (`start_task` refuses a second), held in a module
  singleton in `agent/lib/task.ts`. Two concurrent tasks would need per-session state and a
  worktree each; `apps/tixqa/server/db.ts` is the precedent if it comes to that.
