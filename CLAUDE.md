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
  **This one is currently asked for, not enforced.** It used to be structural — with no `Bash`
  there was no command to push with. The operator asked for the full harness, so `disallowedTools`
  is empty and the shell is back; `agent/instructions.md` tells the agent not to push, and a prompt
  is not a boundary. Gate 3 still stands in front of `open_pull_request`, which is the *intended*
  path out; it is no longer the *only* one. `disallowedTools: ["Bash(git push:*)"]` is the one-line
  way to make it structural again without giving up the shell.
- **The role policy binds — where it is switched on.** One instance, one role, one plain-English
  policy in `roles/`. Enforce it at the tool layer (deny the call), never in the prompt — prompts
  are not a boundary. `judge` in `becode.config.ts` turns all three verdicts off for an instance
  whose operator does not want them; **this instance currently runs with `judge: false`.** That is
  a deployment choice, not licence to weaken the mechanism: new policy logic still belongs in the
  tool layer, and `check:policy` still has to pass.
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
- Node 24 (`.nvmrc`; `nvm use` before anything). No sandbox — the agent edits a real checkout with
  host-native tools. One container, and only one: MinIO, for attachment bytes (`docker-compose.yml`,
  published on **:9040/:9041** because :9000 is another project's bucket). becode runs without it;
  attachments are the only thing that fails, and they fail with the command to fix it.
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
| Attachment bytes, and the URL they are served at | `agent/lib/blobs.ts`, `app/api/attachments/[key]/` |
| What may be attached, and what it becomes | `agent/lib/attachments.ts` (`npm run check:attachments`) |
| git worktree / diff helpers | `agent/lib/git.ts` |
| becode's own tools | `agent/sdk/tools.ts` (one SDK MCP server, `mcp__becode__*`) |
| Filing the Linear issue a PR is tracked by | `agent/lib/linear.ts` |
| **The agent loop and all three gates** | `agent/sdk/session.ts` |
| Answering the agent's questions | `askQuestions` in `agent/sdk/session.ts`, `app/api/agent/answer/` |
| Always-on system prompt | `agent/instructions.md` |
| HTTP surface | `app/api/agent/route.ts`, `approve/route.ts`, `status/route.ts`, `run/route.ts` |
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
from `app/api/agent/route.ts` rather than an agent turn. `toBlocks` stays pure and sync so
`check:attachments` needs no network, and the upload happens *after* it returns — a refused file
never reaches storage.

**The bytes go to MinIO; the transcript keeps a URL.** They used to travel as base64 inside the
replay body, and reopening a chat meant re-escaping every screenshot into one JSON string that the
browser could not cache. Worse, `REPLAY_ATTACHMENT_BUDGET` was 6 MiB of base64 for a whole chat
while one upload may be 5 MiB — ~6.99M chars — so **a single maximum-size image was already over
the budget and was dropped**, silently, with `continue` rather than `break`, so a big image
vanished while a smaller one later in the same turn still rendered in its original slot. Now
`putBlob` (`agent/lib/blobs.ts`) stores it under the **sha256 of its content** and the event keeps
`/api/attachments/<sha>`. A key names exactly one sequence of bytes, so the same screenshot
attached twice is one object and the response is `immutable` — there is no invalidation to get
wrong. The key is validated against `/^[0-9a-f]{64}$/` in the route: it arrives from a URL.

A stored image also keeps its **real filename**. It could not before — `toBlocks` sets `title` on
the PDF branch but Anthropic's `ImageBlockParam` has nowhere to put one, so replay fell back to the
literal string `"image"` and that landed in `alt=`.

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
is empty, inserts whatever the file declares. `allProjects` / `findProject` / `addProject` /
`saveProject` are the only ways in; nothing imports `becode.projects.ts` any more except the seed
path.

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

## Correcting a recipe the agent got wrong

`propose_project` can only ever **add**. `addProject` throws on a duplicate id, and the gate wants
`project.path` to equal `chat.discoveryRoot` — which is cleared the moment a project is added. So a
dev script that turns out to pin its own port, or a service that moved, had no way back out except
the sqlite file, and `saveProject` sat with no caller outside `db.check.ts`.

The gear on a sidebar project row opens that recipe as a form (`app/_components/project-settings.tsx`
→ `PATCH /api/projects/[id]`). **`id` and `path` are not editable** and are taken from the stored
row: worktrees and chats are keyed on them, and a different repo is a different project. Neither is
`designSystem`, which is not on the form and is preserved. Ports live as strings while they are
being typed, so backspacing one is empty rather than `NaN`; a service's port stays optional, because
a service binds whatever its own env says and only declares one so the port gate can spot a stale
process squatting there.

Validation is a zod schema in the route, not in the client — the form is a convenience and the route
is the boundary. `explain()` turns the issue into a sentence naming the row (`"storefront" needs a
port number between 1 and 65535.`) and returns the path as `field`, which is how the form marks the
input; zod's own `apps.0.port: Too small` is a stack trace to the person this is built for. An edit
lands in sqlite immediately and is read at the next `run_project`; nothing restarts a server that is
already up.

Two things the form marks itself rather than inheriting. `InputGroup`'s built-in
`has-[…aria-invalid…]` error style **never compiles in this project** — verified absent from the
running stylesheet — so the invalid ring is set from the error state directly. And `border-*`
utilities lose to the unlayered `* { border-color: var(--border) }` in `globals.css`, the same trap
as the font rule documented beside it, so the ring carries the error and the border does not.

**The agent still cannot edit a recipe** — no tool reaches `saveProject`. It has `Bash` now, so
`sqlite3 ~/.becode/becode.db` would work; `agent/instructions.md` asks it not to, and that is a
request, not a boundary. The same sentence as the one at the top of this file.

## Chats, history, and two at once

**One chat, one `Chat` in `agent/lib/task.ts`** — a `Map` keyed by session id, not a singleton.
`tool()`'s handler is given `extra: unknown`, so the SDK offers no way to tell which chat a call
came from; that is why `agent/sdk/tools.ts` is a **factory** (`becodeTools(chat)`) built once per
run around the chat's state. A new chat has no session id when its query starts, so the run holds
the object and registers it under the id the init message reports — tool calls always come after
init, so `start_task` is never slot-less.

**The `Map` is a cache over a sqlite row, not the record.** It was the record, and that cost a
chat its worktree every time `next dev` re-evaluated the module — which is every save. The chat
resumed, `chat.task` came back `null`, `run_project` answered "No task started", `cwd` fell back to
the source checkout, and the model's only legal move was `start_task` again: `freeName` saw the old
directory, cut `<slug>-2` fresh off the base branch, and the previous turn's edits sat in a
directory nobody would open again. Fifteen of them accumulated for one change. `setTask` writes on
the two assignments that matter rather than at end-of-turn — a reload lands mid-turn as often as
between them — and `chatFor` stats the worktree before it trusts a row, so one deleted by hand
comes back as `task: null` instead of a path every read denies.

**Deleting a chat deletes its worktree.** `DELETE /api/sessions/[id]` calls `forgetChat`, which
hands back what the chat owned, and `removeWorktree` runs on it — the function's first caller. The
same chat is keyed under every session id it ever reported, so siblings are left pointing at a
directory that is now gone; the stat in `chatFor` is what makes that harmless.

**The sidebar is the SDK's; the conversation is becode's.** The Agent SDK keeps every session on
disk — the same store `resume` reads — and exports `listSessions({dir})`, `getSessionMessages`,
`renameSession`, `deleteSession` and `tagSession`. `listSessions` groups by project directory and
follows git worktrees, which is exactly how tasks are laid out, so the **list** at
`GET /api/sessions` is a query, not a table, and titles, branches and the tag stay the SDK's.
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

**Reading a chat back is a different job from listing them, and it moved.** Replay used to walk
the SDK's JSONL — double-digit megabytes in this repo's own project directory — and re-escape
every attached image into one blocking JSON body. The `messages` table in `agent/lib/db.ts` is now
the record: one `AgentEvent` per row, written through the single `emit` chokepoint in `session.ts`,
so the browser and sqlite always see the same stream. Four things follow:

- **The person's own turn is `keep`-ed, not emitted.** Live, the browser already rendered it — it
  typed it. `user` events exist for replay, and this is where they come from now.
- **Rows are written per event, not at end of turn**, so an aborted turn keeps what it produced.
  They are buffered only until the init message reports a session id; there is no row before that.
- **A new session id takes the history with it.** A fork or a compaction reports one, and
  `moveEvents` carries the rows over — otherwise everything said before becomes unreachable from
  the sidebar, which only knows the new id.
- **Chats older than the table still open.** `GET /api/sessions/[id]` prefers the rows and falls
  back to `getSessionMessages` + `replayEvents`. Resuming such a chat calls `backfillEvents` first:
  without it the table would start at the current turn and the read path, which prefers a table
  holding a single row, would call that the whole conversation.

Reopening a chat replays it as the **same event stream** a live turn produces
(`agent/sdk/transcript.ts` walks the blocks once, for both), folded by the same client reducer. A
replayed tool row cannot render differently from the one that streamed.

## Seeing what is running, and why it isn't

**"Running" means the port answers.** The process alone is not evidence: `shell: true` makes becode's
child `/bin/sh -c ...` and the dev server its grandchild, so the shell outlives a server that
crashed under it. `serverUp` in `tools.ts` requires the declared port to accept a connection
(`isListening` in `agent/lib/ports.ts`, both address families — vite binds `[::1]` and answers on
nothing else). This is why services declare a `port`: without one there is nothing to check.

**Nothing is filtered out for being broken.** `liveStatus()` used to return only what was up, so a
crashed backend *vanished* from the bar instead of showing as broken — the person was left with no
sign anything was wrong and nothing to click. It now returns everything, with `running`, `exitCode`
and `pid`, and `run_project` restarts anything that is not actually serving rather than skipping it
as "already up".

**The output is kept.** `agent/lib/logs.ts` is a 256KB ring buffer per process with an **absolute**
cursor, so a reader asks only for what it has not seen and is told when it fell behind. The old
buffer was forty chunks with `shift()` — seconds for a Nest boot, so whatever killed it was gone
before anyone looked. `GET /api/agent/logs?name=&from=` backs a 1s poll from the modal
(`app/_components/server-logs.tsx`); the agent reads the same buffer through `read_logs`.

**Starting it is a button, not a request.** "Start the project" is not a change, so gate 1's judge
refused it — correctly, and uselessly. `POST /api/agent/run` calls the same `bootProject`
`run_project` does, from the header's Start/Stop button (`live-status.tsx`), with no judge: booting
is not a product change and the person clicking it is the person the policy protects. Apps run in
the chat's worktree when it has a task, the source checkout when it does not.

**A service with a declared port gets a URL too.** It used to be apps only, so the backend showed as
"up" with nothing to click — the one server whose logs you want is the one you cannot open. `Server`
now carries an explicit `app` flag, because `url` was doubling as "is this an app", which is what
`takeAppPorts` reads to leave shared services alone.

**becode's own environment does not reach a target's servers.** `next dev` sets
`process.env.PORT = 4000` (`start-server.js`), and children inherited it — so the tix backend bound
becode's own port instead of the 3031 in its `.env` and died with EADDRINUSE, invisibly, for as long
as this repo has existed. `childEnv` strips `PORT`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`
and `BECODE_*`; an explicit override still wins, which is how apps get their port.

**Apps are detached, and reaped on exit.** `spawn(..., {shell: true})` makes the child `/bin/sh -c`
and the dev server its *grandchild*, so `child.kill()` took down the shell and left the server
holding :3002. Apps now run `detached: true` — their own process group — and are stopped with
`process.kill(-pid)`. Detaching is why `tools.ts` installs an `exit`/`SIGINT`/`SIGTERM` handler:
without it a becode that stops leaves a dev server on the port that the next run cannot see, cannot
kill, and cannot boot past. Services are left alone; they are shared and every task needs them.

**A port becode did not take is a question, not an error.** If a port is held by a process whose
**group** is outside `ownedPids()` — matching on pid alone flags becode's own apps, since it tracks
the shell and the listener is that shell's grandchild — a leftover from a becode that crashed, or
the person's own `next dev` —
`canUseTool` names the processes and asks before stopping them (`agent/lib/ports.ts`, `check:ports`).
Killing blind is not becode's call; retrying forever is what it used to do instead.

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

**A request is judged for what it asks, a change for what it does.** Gate 1 used to be given the
strict rules written for a diff, and refused a *critique* on the grounds that one might surface
behavioural fixes — a guess about work nobody had done. `REQUEST_RULES` in `judge.ts` now says to
rule on the ask: reading, reviewing and planning change nothing and are allowed, ambiguity resolves
to the in-bounds reading, and "this could lead somewhere the policy forbids" is not a reason,
because gate 2 refuses that write when it is attempted. `CHANGE_RULES` keeps refuse-when-unsure,
since nothing comes after gate 3.

**`judge: false` turns all three verdicts off.** `judgeRequest` and `judgeChange` return allowed
without a call; `roles/<role>.md` stops binding, and this becode will implement a pricing or auth
change if asked. What is left of the arrangement: `resolveInWorktree` still confines `Read`,
`Edit` and `Write` to the worktree, the read grant still refuses a real `.env`, and gate 3 still
blocks on a person clicking approve. `session.ts` warns once per process so the state is not
something you find in a diff, and `check:policy` calls `judgeAgainstPolicy` directly so the policy
stays testable while unenforced.

The built-in tools are **host-native**: `Read`, `Glob`, `Grep`, `Edit` and `Write` act on the real
checkout.

**`disallowedTools` is now empty, and that is a deployment choice like `judge: false`.** `Bash`,
`Task`/`Agent`, `WebSearch`, `WebFetch` and `AskUserQuestion` were removed from the request
outright — the model never saw them. The operator asked for the whole harness, so they are back,
and `FULL_ACCESS` in `session.ts` allows them at the gate, because `canUseTool` defaults to deny
and un-removing a tool alone would leave it refused.

Be clear-eyed about what that costs, because it is the invariant at the top of this file:

- **`Bash` is not confinable by `resolveInWorktree`.** That check takes a path; a command is a
  string. Inside a shell the worktree boundary and "a pull request or nothing" are what
  `agent/instructions.md` asks for, not what the tool layer enforces. A one-line scoped rule —
  `disallowedTools: ["Bash(git push:*)"]` — buys the second one back without giving up the shell.
- **`Task` does not open a second permission surface.** `canUseTool` receives `agentID` for
  subagent calls, and a live turn confirms it: a subagent's `Bash` shows up as a gated tool row
  like any other. The `Agent` call *itself* appears not to reach the callback, but everything it
  goes on to do does.
- **Gates 2 and 3 are untouched.** Every `Edit`/`Write` is still judged and still path-checked, and
  `open_pull_request` still stops for a person.
- **`AskUserQuestion` is answered in `canUseTool`, and that is the only place it can be.** See
  below.

Every path, read or write, goes through `resolveInWorktree` in `canUseTool`. `cwd` alone is not a
boundary: it is fixed when the query starts, so on the turn that calls `start_task` there is no
worktree yet — and an absolute path ignores `cwd` entirely. Without the check, `Read` would reach
becode's own `.env.local`. The model declining to do that is not a boundary either.

`propose_project` has a fourth gate, and it is the only one with **no judge**: adding a project is
setup, not product work, so the role policy has nothing to rule on. A person confirms it, and the
path must be the exact folder they picked.

## The agent's own questions

`AskUserQuestion` is answered by the person, and the wiring is not where you would guess.

**becode never runs the tool.** The CLI does, and it reads the answers back out of *its own input*.
With a terminal it fills them in by rendering the questions as the tool's permission prompt. The
SDK's equivalent of that prompt is `canUseTool` — so the answers go in as `updatedInput`:

```ts
return { behavior: "allow", updatedInput: answers ? { ...input, answers } : input };
```

That is byte-for-byte what the CLI's own renderer sends. `answers` is keyed by the **question's
text**, valued by the option's **label**, verbatim.

**The `onUserDialog` route is a dead end here, and it looks like the right one.** The CLI registers
a `permission_ask_user_question` dialog kind, and `supportedDialogKinds` + `onUserDialog` are real
options that typecheck. It was built and it never fired: that dialog *is* the permission prompt, so
a host with a `canUseTool` that returns `allow` has already answered the question the dialog exists
to ask. Do not spend the afternoon again.

**Four answer shapes, all verified on live turns**, because the docs only describe two:

| The person… | The agent is told |
| --- | --- |
| picks an option | `Your questions have been answered: … You can now continue with these answers in mind.` |
| picks several (`multiSelect`) | same, from `"Hero, FAQ"` — comma-separated, which the CLI parses back |
| types their own words | `The user answered: … Read the answers carefully — they may request clarification, changes, or that you not proceed` |
| answers nothing | `The user did not answer the questions.` — the pre-wiring behaviour, kept deliberately |

The last row is why an unanswered question is `null` rather than an error: it hands the CLI back its
own default, and `agent/instructions.md` tells the agent to ask again in prose instead of choosing.

The rest is machinery becode already had. `askQuestions` is `askPerson` with a different answer
type, `pendingQuestions` is `pendingApprovals`, `POST /api/agent/answer` is the approve route, and
`ApprovalCard` in `components/agents/` — written for eve's `ask_question` and unused ever since —
renders `questions[]` with `options[]`, `multiple` and `allowCustom` without a fork. Option
descriptions are folded into the *displayed* label and stripped from what is sent, so the CEO reads
"Sticky — stays visible while scrolling" and the model receives `Sticky`.

Both events go through `emit`, so a reopened chat replays the card and its answer with no second
read path.

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

## Linear

Every pull request becode opens is filed as a Linear issue first (`agent/lib/linear.ts`), and the
issue identifier goes into the pushed branch name: `becode/tix-123-<slug>`. That name is the whole
link — Linear's GitHub integration attaches the PR, and moves the issue on open and on merge. The
state machine is a feature Linear already ships; becode does not reimplement it.

**At PR time, not at `start_task`.** An issue created when a chat starts would be an outbound write
to a shared workspace on the weakest gate becode has — gate 1 judges the agent's *restatement* of
the request — and every abandoned experiment would leave one behind. Inside `open_pull_request`,
gate 3 has already judged the real diff and a person has already clicked approve. The cost is that
work in progress is untraced; that was the trade.

**The branch is not renamed locally.** `git push origin HEAD:refs/heads/<name>` puts the identifier
on GitHub, which is the only place Linear reads it. A local `git branch -m` would have broken the
release at the end of the same function: `appOwner` is keyed on the branch `run_project` booted the
apps under, so `takeAppPorts(undefined, current.branch)` would silently miss and leave dev servers
on :3000/:3002 serving a worktree the next task is about to reuse.

**Linear failing does not stop a PR.** `fileIssue` is caught, not awaited into a throw: the PR opens
on `becode/<slug>`, untracked, and the tool result carries a warning the agent is told to relay.
`LINEAR_API_KEY` absent is not an error at all — `hasLinear()` skips the call. The key is stripped
by `childEnv` like every other credential; `check:boot` asserts it.

Both references are kept in `Chat.shipped[]` (`agent/lib/task.ts`) rather than on `Task`, because
`open_pull_request` ends the task with `setTask(chat, null)` one line after the PR URL arrives — the
moment both references first exist is the moment `Task` is destroyed. The transcript renders them
through `@beui/citations` in `agent-message.tsx`, derived from the `open_pull_request` tool row
rather than a new event, so a reopened chat shows them with no second read path.

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
There are 5:

| Skill | For |
| --- | --- |
| `design-system-first` | **becode-authored.** Read the target's design system, reuse before inventing, change only what was asked |
| `design-taste-frontend` | Landing pages, portfolios, marketing surfaces — the marketing role's actual territory |
| `high-end-visual-design` | Craft standards |
| `redesign-existing-projects` | Audit-first, framework-agnostic |
| `impeccable` | Craft direction and its sub-commands (`shape`, `critique`, `audit`, `polish`, …) |

`impeccable` comes from `npx impeccable install` (npm, `impeccable.style`), which writes to
`~/.claude/skills/` — a path `settingSources: []` means the SDK never reads. Only `SKILL.md` and
`reference/` are copied here; the 3MB `scripts/` is not. That was because `Bash` had been removed
from the agent's tool surface, so every one of its detectors, screenshot passes and `npx
impeccable` calls was a command the agent could not run — and `SKILL.md`'s Setup section is
rewritten to say so, or the first thing the skill does is spend a turn on a denied `node
scripts/context.mjs`. **The shell is back, so that reasoning has expired**: re-copying `scripts/`
and reverting the Setup edit would now work. It has not been done — the fork still says there is no
shell. Re-run the installer for the global copy, then re-copy, if you want the detectors.

**A target repo's impeccable context is the design system, when it has one.** Impeccable keeps
`PRODUCT.md` (what the product is and who for) and `DESIGN.md` (its tokens, and the reasoning) at a
project root, with a sidecar at `.impeccable/design.json`. `start_task` reports which of them the
worktree carries (`agent/lib/impeccable.ts`), and `design-system-first` says to read them first.

The third state is why that is a file rather than four inline stats. `git worktree add` copies
**tracked** files only, so a repo where someone ran the installer and never committed looks exactly
like a repo that never had impeccable — from inside the worktree, which is all a task ever sees. So
detection stats the source checkout too, and `uncommitted` gets a different answer from `missing`:
one needs a commit, the other needs an install first. `check:impeccable` drives all three.

The commands themselves live in `app/_components/impeccable-setup.tsx`, not beside the detection —
`agent/lib/impeccable.ts` reads the filesystem, and importing it into a client component would drag
`node:fs` into the bundle. Only the type crosses, and a type is erased. The card is derived from the
`start_task` tool row exactly as `shippedLinks` derives citations from `open_pull_request`, so a
reopened chat renders it with no second read path.

becode does not run the installer. `/impeccable init` interviews the person and `/impeccable
document` reads their code. It has the shell for that now, but `AskUserQuestion` reaches nobody in
a web page (see the note under How the constraint works), and an interview is the whole of `init` —
so both are still a Claude Code session in the target repo. becode's job is to notice it has not
happened.

One caveat on `design-taste-frontend` here: parts of it assume a shell (`npx shadcn@latest add`)
and image generation. The shell it now has; image generation it does not. So the installer works
and the mock-up steps do not.

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
- **"Ship this change"** is a `Button size="sm"` above the composer — already a pill
  (`h-8 px-3 rounded-full`), no new component. It calls `agent.send` directly, so the empty-textarea
  rule above does not apply to it. It appears when the transcript holds a successful `Edit`/`Write`
  with no successful `open_pull_request` after it — derived from the messages the client already
  has, so a reopened chat gets it too and there is no second poll. `start_task` would be the wrong
  signal: a policy refusal is still a successful call. The pill replaces the typing, not the
  confirmation — gate 3 still judges the real diff and still renders the approval card.
- **Skill chips while typing.** `lib/skill-suggestions.ts` maps how a person describes a problem
  ("cramped", "bland", "loud") to the skill that handles it. The chip reads as plain language, the
  real name (`impeccable · critique`) is on hover, and the *prompt* gets the precise sentence — so
  the CEO never types jargon and the agent never has to guess. Keyword counting over an eight-row
  table: no dependency, no debounce, no server call, and `check:suggestions` guards the ranking.
  This costs the composer its uncontrolled `PromptInput`: the component forwards no ref and keeps
  its textarea private, so a chip has no way in unless `value` is passed. Note `submit()` only
  clears `internalValue`, and only when uncontrolled — `handleSubmit` now clears `draft` itself, or
  the chips stay pinned under an empty composer.
- **Typing a skill, and painting it.** Every skill is a slash command: the SDK's `SlashCommand.name`
  *is* the skill name, and the plugin registers becode's five as `becode:<name>` with the bare
  `<name>` as an alias — both resolve. `app/page.tsx` is a server component, so the list is
  `agent/lib/skills.ts` reading the directory, not a route and not a fetch.

  **Only a leading token expands.** Verified against a live session: with a prompt starting
  `/impeccable …` the model quotes the skill body verbatim while `Read` is disallowed, so the
  content was injected; move the same token one word in and it answers "NONE". `lib/skill-tokens.ts`
  is therefore a position rule, not a search-and-replace — painting a mid-sentence `/impeccable`
  would promise something that never happens. `check:tokens` holds both that and the invariant that
  matters for the overlay: the tokens must cover the input exactly.

  This is also why the suggestion chips append plain English rather than a slash command: they land
  mid-prompt, where a command is only ever text.

  Painting it costs `PromptInput` a second small fork. A textarea cannot colour part of its own
  content, so `highlight` renders a mirror div under a `text-transparent caret-foreground` textarea,
  sharing the typography of the autosize measurement div that was already there and syncing
  `scrollTop`. `--skill` in `app/globals.css` is the one chromatic value in an otherwise fully
  neutral palette, and it exists for this alone.
- **The sidebar is hand-rolled.** `@beui/ai-sidebar` was installed and removed: no trailing-action
  slot for the `+`, no controlled expansion (a collapsed row cannot be reopened from state), and a
  drag-to-move affordance that would be a lie — a chat belongs to the worktree it created. Three
  workarounds cost more than the eighty lines in `app/_components/chat-sidebar.tsx`.
- **`approval-card` renders the agent's questions.** It was written for eve's `ask_question` and
  sat unused for as long as `AskUserQuestion` was in `disallowedTools`; its `questions`/`options`/
  `multiple`/`allowCustom` shape turned out to be exactly `AskUserQuestion`'s. `tool-approval` is
  still what gate 3 renders — approve/deny, not a choice among several.

`components/motion/text-shimmer.tsx` carries a **local fix**: the registry ships it importing its
own constants from itself, which does not compile. It should come from `@/lib/text-shimmer`.
Re-running `shadcn add` for anything depending on it will reintroduce the break.

## Running it

```bash
nvm use                      # Node 24 — .nvmrc; the SDK requires >=24
claude setup-token           # mints a long-lived subscription token
cp .env.example .env.local   # then paste it as CLAUDE_CODE_OAUTH_TOKEN
npm install                  # first time only
docker compose up -d         # MinIO, for attachment bytes — :9040, console on :9041
npm run dev                  # http://localhost:4000
```

`npm run dev` is the whole app: Next.js serves the UI, and `POST /api/agent` runs the agent in a
Node route handler, streaming NDJSON back. There is no second Node process and no daemon —
`docker compose up -d` starts MinIO, which is not one.

becode itself sits on **:4000**, not :3000, because :3000 belongs to a target app (tixvendor).
Target apps keep their native ports: their env files and the backend's CORS allowlist are
already written for them, and moving becode is a one-line change while moving them is not.

Without a credential the UI loads and the first message comes back as a plain error naming the
fix — `hasAuth()` in `agent/sdk/session.ts` checks before anything else runs. `ANTHROPIC_API_KEY`
works too if you would rather be billed per token.

No sandbox, no keychain prompt. becode edits a local checkout with host-native tools; there is
nothing to virtualize. The one container holds attachment bytes, not code.

## Commands

```bash
npm run typecheck            # tsc --noEmit
npm run check:policy         # the role policy against 10 known allow/refuse cases — run this first
npm run check:boot           # port math, liveness, and the env-file copy — no servers started
npm run check:attachments    # the attachment allowlist and its caps — video refused, no network
npm run check:db             # the store: projects, a chat keeping its worktree, the conversation
npm run check:blobs          # object storage: round trip, content-addressing, key validation
npm run check:reads          # the read boundary: worktree, discovery grant, secrets, Grep
npm run check:ports          # finds and frees a real listener — starts one, kills it
npm run check:logs           # the log ring buffer: trimming, absolute cursors, stale readers
npm run check:impeccable     # design context: found, found-but-uncommitted, absent
npm run check:suggestions    # the composer chips: threshold, ranking, cap
npm run check:tokens         # slash tokens: leading-only, exact coverage, real skills only
npm run build                # next build
npm run dev                  # the app
claude setup-token           # re-mint the subscription token when it expires
```

`check:policy` is the cheapest end-to-end signal in the repo: it exercises the token, the judge,
and the role policy in one command without touching the UI. Run it before debugging anything else.
It ignores `config.judge` — a policy you cannot test is not one you can switch back on with any
confidence — so a green run says nothing about whether this instance is enforcing it.

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
  `Bash(rm *)` only blocks matching calls. Deny rules beat every permission mode. This list is
  empty today — see the note under How the constraint works — so the second half, `FULL_ACCESS` in
  `canUseTool`, is what actually lets those tools run.
- **A tool's name in `disallowedTools` is not always the name `canUseTool` sees.** Subagents are
  `Task` in the deny list and arrive as `Agent` in the callback. Verified on a live turn; both are
  in `FULL_ACCESS`.
- **`AskUserQuestion` is answered by the CLI out of its own tool input.** A host supplies the
  answers through `canUseTool`'s `updatedInput`, not through `onUserDialog` — see The agent's own
  questions. `PermissionResult.updatedInput` is not only for narrowing a call; it is the documented
  way to hand a tool data it could not have had.
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
- **`next dev` HMR forgets the children.** Editing `tools.ts` re-evaluates the module, so `live`
  empties while the dev servers keep running. The exit handler still reaps them (the old module's
  closure fires), and the port gate catches the duplicates, so it degrades rather than breaks — but
  the bar goes blank mid-session. Not a concern under `npm start`.
- **A restart still orphans the dev servers.** The `Chat` rows survive it now, but `live` and
  `appOwner` in `tools.ts` do not, so the apps from before the restart keep their ports with
  nothing tracking them. The port gate catches it and asks before killing them, which is the
  behaviour — just not a pleasant one.
