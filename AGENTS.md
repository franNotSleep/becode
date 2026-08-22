# becode

An agent built on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) inside a Next.js app.
Read `CLAUDE.md` first — it carries the invariants, the layout, and the one fact you must not get
wrong about permissions.

## Read the docs before writing SDK code

The installed types are what actually ships:

```sh
node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts        # Options, CanUseTool, PermissionResult
node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts  # built-in tool input shapes
```

Prose docs are at <https://code.claude.com/docs/en/agent-sdk> — start from
`/typescript` (API reference) and `/permissions` (the evaluation order). When the docs and the
`.d.ts` disagree, the `.d.ts` wins. Do not infer this API from other agent frameworks, and say
plainly when neither settles it.

Use a bounded authoring loop:

1. Read the relevant type or page and inspect only files you will modify or need to imitate.
2. Stop discovery once the shape is clear. Implement the smallest complete behavior requested.
3. Run one narrow verification. Expand only when it fails.

## Where things go

- **A new agent capability** → a `tool()` in `agent/sdk/tools.ts`, added to `becodeTools`. It runs
  in-process against the host filesystem; there is no sandbox.
- **A new policy rule** → `roles/<role>.md`, in plain English. Never in a prompt, never in code.
- **A new target project** → a row via `addProject` in `agent/lib/db.ts`. `becode.projects.ts` only
  seeds an empty store; editing it after first run changes nothing.
- **Anything touching what the agent may do** → `canUseTool` in `agent/sdk/session.ts`, and read
  the permissions warning in CLAUDE.md before you touch it.
- **A new skill for the target repo** → `agent/skills/<name>/SKILL.md`. Auto-discovered.
- **Custom HTTP** → a Next.js route handler. Do not add a second server.

## Validate the change

`npm run check:policy` is the cheapest end-to-end check — token, judge, and role policy in one
command, with ten known allow/refuse cases. Then `npm run typecheck`. Run the narrowest check that
actually exercises what you changed.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
<!-- END:nextjs-agent-rules -->
