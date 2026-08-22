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
  repo (package manager, scripts, compose/env files) or declared in per-project config. Projects
  live in `agent/lib/db.ts`; `becode.projects.ts` only seeds an empty store.
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
| Target repos and how to boot them | `agent/lib/db.ts` (seeded from `becode.projects.ts`) |
| The `Project` shape, port maths | `agent/lib/projects.ts` |
| Per-chat state: the task, its worktree, its project | `agent/lib/task.ts` |
| Content blocks → the events the browser renders | `agent/sdk/transcript.ts` |
| Chat history and the sidebar | `app/api/sessions/`, `app/_components/chat-sidebar.tsx` |
| What may be attached, and what it becomes | `agent/lib/attachments.ts` (`npm run check:attachments`) |
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

## Attachments

Images, PDFs and text/code reach the model as Messages API **content blocks**, never as files on
disk. That is deliberate: the read boundary in `resolveInWorktree` does not have to widen, and on
the turn that calls `start_task` there is no worktree to write into anyway.

`agent/lib/attachments.ts` is the trust boundary — an allowlist (png/jpeg/gif/webp,
`application/pdf`, text and a code-extension set), 5 files, 5MB each, 15MB a turn. The browser's
`accept` attribute is a convenience; this is the check. Anything else, video included, is a 400
from `app/api/agent/route.ts` rather than an agent turn.

Blocks only exist in `query`'s streaming-input form (`prompt: AsyncIterable<SDKUserMessage>`), so
`session.ts` keeps the plain-string prompt when nothing is attached and switches forms only when
something is. Gate 1 needs them too: `judgeRequest` rules on what `start_task` was asked for, and
the ask is often *in* the screenshot — "do this" beside a mock reading "make everything free" would
otherwise be judged as "do this". The turn's blocks sit in a module singleton next to `task` so the
judge can reach them from inside the tool call. Gate 2 and gate 3 stay text-only; they read the
diff, which says what it does on its own.

## Where projects live

`becode.projects.ts` is now the **seed**, not the record. `agent/lib/db.ts` opens a `node:sqlite`
database at `~/.becode/becode.db` (Node 24 ships it; no dependency) and, the first time the table
is empty, inserts whatever the file declares. `allProjects` / `findProject` / `addProject` are the
only ways in; nothing imports `becode.projects.ts` any more except the seed path.

The reason is not per-person data — one becode per person on their own machine, so a file was
already per-person. It is that the agent is meant to work a repo's boot recipe out for itself, and
it cannot write `becode.projects.ts`: that file is becode's own source, outside every worktree, and
`canUseTool` refuses it. A project stops being source code the moment something other than a human
authors it.

The whole `Project` is one JSON column rather than tables for apps and services — every read is
"give me all the projects", and `Project` in `agent/lib/projects.ts` already owns the shape.
`BECODE_DB` points the store elsewhere, which is how `check:db` runs against a temp file.

## Adding a project the agent has never seen

The `+` beside **Projects** opens a folder picker — a `CommandDialog` (cmdk, already in
`components/ui/`) over `GET /api/folders`. The listing is served rather than native because **no
browser API returns an absolute path**: `webkitdirectory` gives paths relative to the folder that
was chosen, and `showDirectoryPicker()` gives a handle with a bare name. Cursor opens the OS dialog
because it is a native app; becode is a page in front of a local Node process. Serving it is better
here anyway — the rows can say which folders are git repos and which are already projects. The
route lists directory **names** only, never contents, and refuses anything outside the home
directory; typing a path into the search box still jumps straight there.

Picking a repo opens a chat whose `Chat.discoveryRoot` is that path. While such a chat has no task, `canUseTool`
allows reads under **that one folder** instead of a worktree. `resolveInWorktree` is unchanged and
still governs every write; nothing else widens.

Two rules keep a real checkout from leaking into a stored recipe, learned the hard way — the first
run of this proposed a boot command with the repo's live database URL and five API keys inlined:

- **`.env`, `.env.local`, `.env.production` are unreadable while there is no task.** `.env.example`
  and `.env.sample` are fine: a recipe needs variable *names*, and `createWorktree` copies the real
  env files into every worktree anyway, so a command must never carry values.
- **`Grep` is unavailable while there is no task.** It prints matching lines, so a path rule cannot
  protect a secret from it — one search for `PORT` echoes the whole `.env` back. Discovery lists
  (`Glob`) and reads (`Read`); inside a worktree `Grep` is how the agent finds anything and stays.

The rules live in `agent/lib/reads.ts`, not inline in `canUseTool`, so `npm run check:reads` can
drive every branch. Asking the agent to read a `.env` proves nothing — it declines conversationally
before the gate is ever consulted, and a prompt is not a boundary.

`propose_project` returns a draft `Project`; the person approves it through the same awaited
promise gate 3 uses (`askPerson` in `session.ts`), and `addProject` writes the row.

## Chats, history, and two at once

**One chat, one `Chat` in `agent/lib/task.ts`** — a `Map` keyed by session id, not a singleton.
`tool()`'s handler is given `extra: unknown`, so the SDK offers no way to tell which chat a call
came from; that is why `agent/sdk/tools.ts` is a **factory** (`becodeTools(chat)`) built once per
run around the chat's state. A new chat has no session id when its query starts, so the run holds
the object and registers it under the id the init message reports — tool calls always come after
init, so `start_task` is never slot-less.

**History is not becode's to store.** The Agent SDK keeps every session on disk — the same store
`resume` reads — and exports `listSessions({dir})`, `getSessionMessages`, `renameSession`,
`deleteSession` and `tagSession`. `listSessions` groups by project directory and follows git
worktrees, which is exactly how tasks are laid out, so `GET /api/sessions` is a query, not a table.
Two things make it work:

- **`cwd` decides where a transcript is filed.** It used to fall back to `WORKTREE_ROOT`, so a
  chat landed in `~/.claude/projects/…--becode-worktrees/` — a folder with no project identity,
  invisible to `listSessions({dir})`. The sidebar's `+` picks the project before the first
  message, so `cwd` can be the project checkout. `cwd` is inert for permissions — `canUseTool`
  confines reads to the worktree either way.
- **`tagSession(id, "becode")` runs at the *end* of a turn**, not on the init message: the CLI has
  not written the session file yet at init and the tag silently finds nothing. The tag is what
  separates becode's chats from your terminal sessions in the same repo — a chat that never starts
  a task sits on the project's own branch and is otherwise identical.

Reopening a chat replays it as the **same event stream** a live turn produces
(`agent/sdk/transcript.ts` walks the blocks once, for both), folded by the same client reducer. A
replayed tool row cannot render differently from the one that streamed.

**Worktrees are cheap; the ports are the lock.** Two chats can hold two worktrees, edit, diff and
open PRs independently. Only `run_project` is contended, because the apps sit on fixed ports the
backend's CORS allowlist is written for. It **takes the lock over** rather than queueing: the
previous chat's apps are stopped, the new branch's are booted, and the tool says so. One person,
one screen. `open_pull_request` only kills apps its own chat still owns.

`createWorktree` now suffixes a taken name (`<slug>-2`), because two chats picking the same slug is
normal and `git worktree add -b` fails outright on an existing branch.

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

`propose_project` has a fourth gate, and it is the only one with **no judge**: adding a project is
setup, not product work, so the role policy has nothing to rule on. A person confirms it, and the
path must be the exact folder they picked.

All the gates live in **one `canUseTool` callback** (`agent/sdk/session.ts`):

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
- **Attachments.** beUI's `PromptInput` submits `(value, model?)` and has no file parts, so the
  attachment row, the paperclip, paste and drag-drop live in `agent-chat.tsx`, wrapped around an
  unforked `PromptInput` whose own border is stripped. The paperclip goes in its `leadingAction`
  slot. There is no `@beui/attachment-upload` — it does not exist. `@beui/chat-app` does not help
  either: its `prompt-input.tsx` is byte-identical to the one already here and its "Attach file"
  is a label in the demo's `actions` array with no handler behind it. `@beui/file-upload` is an
  upload *queue* — progress, retry, per-file state — for a flow that has no upload step.
  One consequence of not forking: the composer will not submit an empty textarea, so an
  attachment always needs a word beside it.
- **The sidebar is hand-rolled.** `@beui/ai-sidebar` was installed and removed: no trailing-action
  slot for the `+`, no controlled expansion (a collapsed row cannot be reopened from state), and a
  drag-to-move affordance that would be a lie — a chat belongs to the worktree it created. Three
  workarounds cost more than the eighty lines in `app/_components/chat-sidebar.tsx`.
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
npm run check:attachments    # the attachment allowlist and its caps — video refused, no network
npm run check:db             # the project store: seeding, round-trip, duplicate ids
npm run check:reads          # the read boundary: worktree, discovery grant, secrets, Grep
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
- **Parallel tasks, and what they still share.** Solved for state — one `Chat` per session, a
  worktree each. Not solved for the *ports*: `run_project` takes them over rather than allocating a
  block per task, because the backend's CORS allowlist names :3000 and :3002. Per-task ports means
  fixing that in the target repo first.
- **Nothing survives a restart.** The `Chat` map is in-process, so a becode restart forgets which
  worktree a chat owns — the chat still resumes (the SDK stores it), but `start_task` would refuse
  a second one against a task it no longer knows about. `apps/tixqa/server/db.ts` is the precedent
  if that starts to hurt; `node:sqlite` is in Node 24 with no dependency.
