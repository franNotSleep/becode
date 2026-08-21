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
  it at the tool layer (deny the call), never in the prompt — prompts are not a boundary. eve's own
  docs say the same: "Do not rely on model behavior alone to prevent sensitive or irreversible
  actions."
- **Design system is input, not invention.** Before changing UI, the agent reads the target repo's
  design system (tokens, theme config, component library) and works from it. New one-off colors,
  spacings, or components are a bug.
- **Target-repo-agnostic.** Nothing may hardcode Tix. Project setup is discovered from the target
  repo (package manager, scripts, compose/env files) or declared in per-project config.
- **Parallel tasks are isolated.** Concurrent tasks get separate git worktrees and separate ports.
  Two tasks must never share a working tree.

## Stack

**One Next.js project, one dev server.** `next.config.ts` wraps the config in `withEve()`, so
`npm run dev` boots the eve dev server alongside `next dev` and rewrites the eve routes to it. The
browser only ever talks to the Next.js origin — no CORS, no URL env vars. There is no separate
API server, and adding one (NestJS, Express) would be a second process for nothing: custom HTTP
belongs in Next.js route handlers, and agent capability belongs in `agent/tools/`.

- Next.js 16 (preview) · React 19 · Tailwind 4 · shadcn/ui in `components/ui/`
- eve 0.44 — filesystem-first agent framework by **Anthropic**, Apache-2.0. It integrates with
  Vercel (Sandbox, Connect, Chat SDK, `eve deploy`) but is not a Vercel framework.
- Node 24 (`.nvmrc`; `nvm use` before anything). No Docker needed — see Running it.
- Model: `anthropic/claude-opus-5` in `agent/agent.ts`, routed via AI Gateway.

## Layout

eve derives names from file paths — a file's location *is* its registration. There is no separate
config to update when adding a tool, skill, or subagent. When something "isn't being picked up",
run `eve info` before debugging anything else.

| Concern | Where |
| --- | --- |
| **Role policies, in plain English (the thing you edit)** | `roles/<role>.md` |
| **Which role this instance runs as** | `becode.config.ts` |
| Policy check harness | `roles/check.ts` (`npm run check:policy`) |
| The judge | `agent/lib/policy.ts`, `agent/lib/roles.ts` |
| Target repos and how to boot them | `becode.projects.ts`, `agent/lib/projects.ts` |
| Active task, worktree path boundary | `agent/lib/task.ts` |
| git worktree / diff helpers | `agent/lib/git.ts` |
| Agent capabilities | `agent/tools/*.ts` — filename becomes the model-facing tool name |
| Always-on system prompt | `agent/instructions.md` |
| Model / reasoning / limits | `agent/agent.ts` |
| HTTP session API + auth | `agent/channels/eve.ts` |
| CEO-facing UI | `app/` (`app/_components/agent-chat.tsx` uses `useEveAgent`) |
| Build output / manifests (generated) | `.eve/`, `.output/` |

## How the constraint works

One becode instance runs for **one person in one role**. `becode.config.ts` names the role;
`roles/<role>.md` is that role's policy, written in plain English by whoever installs it. Nothing
about the policy is structured — no globs, no path lists — and the agent doing the work never
gets to interpret it. A separate small model (`anthropic/claude-haiku-4.5`, set in
`becode.config.ts`) rules on each case against the policy text, defaulting to refusal when unsure.

The target repo lives on **this machine**, not in the eve sandbox — the sandbox is an isolated
Docker container that cannot see local checkouts. So becode's tools run in the app runtime against
the host filesystem, and `bash`, `read_file`, and `write_file` are **disabled** via `disableTool()`
(`agent/tools/bash.ts` etc.). Leaving a sandbox shell in place would be useless here and would be
a way around the judge. `eve info`'s compiled manifest shows `disabledFrameworkTools`.

Three gates, all reading the same policy file:

1. `start_task` — judges **the request**, before any work starts. Fast, honest refusal.
2. `edit_project_file` — judges **each edit** (path + a required one-line `intent`) in an eve
   `approval` policy. Returning `{type:"denied"}` means eve never runs `execute`; the model gets
   the reason instead of the write.
3. `open_pull_request` — judges **the actual diff** against the original request. This is the one
   that binds: it reads what changed on disk, not what anyone claimed. Passing it still requires
   human confirmation (`"user-approval"`).

Gates 1 and 2 depend on the working agent describing things honestly, so they are UX and early
warning, not a boundary. Gate 3 is the boundary — nothing leaves the machine without it, and the
worktree is disposable if it fails.

Hooks are **not** an option for this: eve hooks are explicitly observe-only and cannot block a turn.

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
repo. `eve info` should show 4:

| Skill | For |
| --- | --- |
| `design-system-first` | **becode-authored.** Read the target's design system, reuse before inventing, change only what was asked |
| `design-taste-frontend` | Landing pages, portfolios, marketing surfaces — the marketing role's actual territory |
| `high-end-visual-design` | Craft standards |
| `redesign-existing-projects` | Audit-first, framework-agnostic |

One caveat on `design-taste-frontend` here: parts of it assume a shell (`npx shadcn@latest add`)
and image generation. becode has neither — `bash` is disabled and it edits through
`edit_project_file`. It can still author component files by hand; it cannot run the installer.

`design-system-first` exists because the off-the-shelf skills actively conflict with the brief
inside someone else's codebase — they say things like "replace the font with one that has
character" and "pick one accent colour, remove the rest." That is right for a greenfield page and
wrong for a marketing manager's "make the headline bigger." It establishes the precedence (project
system wins, general taste applies only where the project has not decided) and carves out the one
exception: accessibility defects get fixed. `agent/instructions.md` requires loading it first.

Skill routing is the `description` frontmatter — eve advertises only that, and the model calls
`load_skill` off it. Write descriptions as "when to use this," not "what this is."

## UI

becode's own interface is built from **beUI** (`@beui`), a shadcn registry of animated React
components — registered in `components.json`, so `npx shadcn@latest add @beui/<slug>` works. There
is no `beui` runtime package; components are copied into `components/`. Fetch
<https://beui.dev/r/registry.json> for the live list. The `beui` MCP server is in local config
(`~/.claude.json`), not the repo — a teammate runs `claude mcp add` themselves.

The eve scaffold's `components/ai-elements/` is **gone**. beUI's agent family replaced it:

| Was | Now |
| --- | --- |
| `conversation` | `@/components/agents/message-scroller` |
| `message` | `@/components/agents/message` |
| `prompt-input` | `@/components/agents/prompt-input` |
| `shimmer` | `@/components/agents/loading-states/thinking-shimmer` |
| `reasoning`, `chain-of-thought` | `@/components/agents/agent-activity` |
| `tool` | `@/components/agents/tool-result` + `tool-approval` |
| `question` | `@/components/agents/approval-card` |

Two things that mapping does not cover:

- **Markdown.** beUI's `Message` is a layout primitive with no markdown renderer, so agent text
  still goes through `streamdown` (a local `Markdown` memo in `agent-message.tsx`).
- **Attachments.** beUI's `PromptInput` submits `(value, model?)` — no file parts. The scaffold's
  composer accepted them and `agent.send()` still does. `@beui/attachment-upload` is the way back
  if pasting a reference image matters.

`components/motion/text-shimmer.tsx` carries a **local fix**: the registry ships it importing its
own constants from itself, which does not compile. It should come from `@/lib/text-shimmer`.
Re-running `shadcn add` for anything depending on it will reintroduce the break.

## Running it

```bash
nvm use                      # Node 24 — .nvmrc; will not build on 22
cp .env.example .env.local   # then paste an AI_GATEWAY_API_KEY
npm install                  # first time only
npm run dev                  # http://localhost:3000
```

`npm run dev` is the whole app: Next.js serves the UI and proxies `/eve/v1/*` to the eve dev
server it boots alongside on a random loopback port. Verify with
`curl localhost:3000/eve/v1/health`.

Without a credential everything starts and routes fine — sessions are created, the stream opens —
and the first model call fails with `MODEL_CALL_FAILED / gateway-auth-missing-credentials`. If
the UI looks alive but nothing answers, that is the reason.

Docker is not needed, and `agent/sandbox.ts` pins `justbash()` so eve never goes looking for it.
Left unpinned, `defaultBackend()` resolves by probing — it runs `docker version` on every boot, and
on a Mac with a `credsStore` in `~/.docker/config.json` that makes the docker CLI call
`docker-credential-osxkeychain`, which pops a keychain password prompt every `npm run dev`. becode
never creates a sandbox at all (nothing calls `getSandbox()` now that the sandbox-targeting
built-ins are disabled), so the probe was for a container runtime it would never use. eve installs
`just-bash` itself the first time it sees the pinned backend — that devDependency is expected.

## Commands

```bash
npm run typecheck            # tsc --noEmit
npm run check:policy         # run the role policy against known allow/refuse cases
npm run build                # next build
npx eve info                 # resolved config + discovery diagnostics
npx eve dev                  # agent-only terminal REPL (no Next.js UI)
npx eve dev --no-ui          # headless — use this for scripted verification
npx eve invoke "<prompt>"    # one turn, no TUI; --json-schema for structured output
npx eve eval                 # run evals/  (--list, --tag, --strict for CI)
npx eve logs ls              # dev-session diagnostic logs; `eve logs <id>` to read
npx eve registry search <q>  # look for an existing integration before writing one
```

`eve dev` opens an interactive REPL — never launch the bare command as a background process.

`next dev` rewrites `AGENTS.md` and `next-env.d.ts` on every run; commit the churn rather than
fighting it. Next.js 16 is a preview with breaking changes — its own generated note points at
`node_modules/next/dist/docs/` rather than training data.

## eve facts this design leans on

Verified against the docs. **Read `node_modules/eve/docs/` first** — it ships with the installed
package and matches its version exactly. `docs/README.md` maps each task to its page. Fall back to
<https://eve.dev/docs> only if the package docs are missing. eve is in preview and its API moves;
do not infer eve APIs from other agent frameworks, and say plainly when the docs don't settle it.

- **Hooks are observe-only** and cannot block a turn. The `approval` policy is the blocking
  primitive — it is async, sees `toolInput`, and can return `{type:"denied", reason}`.
- **The sandbox** is an isolated container rooted at `/workspace`; it cannot see local checkouts.
  `sandbox.spawn()` would keep a process alive across turns if we ever used it.
- **`ask_question`** (built-in) is how to get a decision mid-task instead of guessing.
- **Skills** load on demand off their `description` frontmatter alone. Static markdown returns
  instructions directly — no sandbox involved.
- **Declared subagents inherit nothing** from the root's authored slots and get their own sandbox.
  Multiple built-in `agent` calls in one response run concurrently, so parallel workers need
  non-overlapping write scopes — which one-worktree-per-task provides.

## Open decisions

- **Auth.** `agent/channels/eve.ts` still ships `placeholderAuth()`, which blocks browser requests
  in production. Fine for localhost; must be replaced before this is reachable by anyone else.
- **Real project config.** `becode.projects.ts` has a guessed repo path. Point it at the real
  checkout.
- **Judge cost/latency.** Every edit costs a Haiku call. If that drags, cache verdicts per
  (path, intent) within a session, or drop gate 2 and rely on gates 1 and 3.
- **Parallel tasks.** One task per session (`start_task` refuses a second). Concurrency comes from
  separate sessions, each with its own worktree and an offset port.
