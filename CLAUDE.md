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
4. Agent makes the change, within the allowed change category.
5. CEO looks at the running app and says yes or no.
6. On yes → a PR. Never a direct push to a deploy branch.

## Invariants

These are the point of the project. Do not relax them for convenience.

- **No production writes, ever.** The agent's only output path to a target repo is a pull request
  against a non-default branch. No `git push` to `main`/`production`, no deploys, no force-push.
- **Scoped change category.** Every task carries a change category, and edits outside it are
  refused rather than silently attempted. Enforce this at the tool layer (reject the write), not
  in the prompt — prompts are not a boundary. eve's own docs say the same thing: "Do not rely on
  model behavior alone to prevent sensitive or irreversible actions."
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
- Node 24 (`.nvmrc`; `nvm use` before anything). Docker for the sandbox backend.
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

## UI

becode's own web interface uses **beUI** (`@beui`), a shadcn registry of animated React
components — registered in `components.json`, so `npx shadcn@latest add @beui/<slug>` works.
There is no `beui` runtime package; components are copied in. The `beui` skill
(`.claude/skills/beui/`) maps intent to install slugs, and a `beui` MCP server is configured.
Fetch <https://beui.dev/r/registry.json> for the live list before picking a component.

Note the skill lives in `.claude/skills/` (for Claude Code, building this app), **not**
`agent/skills/` (which would advertise it to the becode agent at runtime — wrong audience).

## Commands

```bash
nvm use                      # Node 24 — do this first
npm run dev                  # Next.js + eve together; this is the app
npm run typecheck            # tsc --noEmit
npm run check:policy         # run the role policy against known allow/refuse cases
npm run build                # next build
npx eve info                 # resolved config + discovery diagnostics
npx eve dev                  # agent-only terminal REPL (no Next.js)
npx eve dev --no-ui          # same, headless — use this for scripted verification
npx eve invoke "<prompt>"    # one turn, no TUI; --json-schema for structured output
npx eve eval                 # run evals/  (--list, --tag, --strict for CI)
npx eve logs ls              # dev-session diagnostic logs; `eve logs <id>` to read
npx eve registry search <q>  # look for an existing integration before writing one
npx eve add <item> --non-interactive
```

`eve dev` opens an interactive REPL — never launch the bare command as a background process.

Needs a model credential: `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`.

## eve facts this design leans on

Verified against the docs. **Read `node_modules/eve/docs/` first** — it ships with the installed
package and matches its version exactly. `docs/README.md` maps each task to its page. Fall back to
<https://eve.dev/docs> only if the package docs are missing. eve is in preview and its API moves;
do not infer eve APIs from other agent frameworks, and say plainly when the docs don't settle it.

- **Sandbox** — one isolated bash env per agent rooted at `/workspace`, with built-in `bash`,
  `read_file`, `write_file`, `glob`, `grep`. Backend resolves in order: Vercel Sandbox → Docker →
  microsandbox → just-bash. This app runs on the CEO's machine, so pin `docker()` rather than
  inheriting a remote default.
- **`sandbox.spawn()`** returns a `SandboxProcess` that persists while the agent does other work.
  That is how target dev servers stay up between turns — not a detached `&` shell job.
- **Approval gating** — `approval: always()` from `eve/tools/approval` on anything that mutates a
  target repo or opens a PR. The turn parks durably at `session.waiting` until a human answers and
  survives process restarts.
- **`ask_question`** (built-in) is how to get a decision mid-task instead of guessing.
- **Skills** load on demand: eve advertises each skill's `description` and loads the body via a
  framework-owned `load_skill` tool. The `description` is the entire routing mechanism — write it
  as "when to use this", not "what this is".
- **Declared subagents inherit nothing** from the root's authored slots and get their own sandbox.
  Multiple built-in `agent` tool calls in one response run concurrently, so parallel workers need
  non-overlapping write scopes — which is exactly what one-worktree-per-task buys.

## Open decisions

- **Auth.** `agent/channels/eve.ts` still ships `placeholderAuth()`, which blocks browser requests
  in production. Fine for localhost; must be replaced before this is reachable by anyone else.
- **Real project config.** `becode.projects.ts` has a guessed repo path. Point it at the real
  checkout.
- **Judge cost/latency.** Every edit costs a Haiku call. If that drags, cache verdicts per
  (path, intent) within a session, or drop gate 2 and rely on gates 1 and 3.
- **Parallel tasks.** One task per session (`start_task` refuses a second). Concurrency comes from
  separate sessions, each with its own worktree and an offset port.
