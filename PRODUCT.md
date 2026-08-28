# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the Tix/Duomir CEO. One becode install, on their own machine, running for them alone.

They are not an engineer and will not read a diff. They describe a change in plain language, look at
the running app, and say yes or no. That single interaction is the whole product surface.

The codebase carries a second role policy (`roles/design.md`, for a design team) alongside the
active `roles/marketing.md`, so the shape supports other non-engineers. No second person is a
confirmed audience today.

## Product Purpose

Turn a plain-language request from someone who cannot read code into a reviewable pull request on a
real product repo — with the change visible in a running app before anyone is asked to approve it.

Success is the CEO changing something about how the product looks or reads, seeing it live, and
getting a PR out of it, without an engineer in the loop and without the ability to break anything
they were not meant to touch.

## Positioning

Four mechanisms, each of which a general coding agent does not have. Two of them are switched off
on this install; see the note below, and do not describe them as active.

- **The policy is a real boundary, not a prompt.** One instance runs for one person in one role.
  That role's permissions are written in plain English in `roles/<role>.md`, and a separate small
  model rules on each case against that text — at the tool layer, where a refusal means the call
  never happens. The agent doing the work never gets to interpret the policy. A marketing manager
  literally cannot change pricing logic, however the request is phrased.
- **A human confirms everything that leaves the machine.** No change reaches a shared branch, and
  no project is added, without someone clicking approve on a card describing what is about to
  happen. This one is unconditional.
- **They see it running first.** The target repo's own dev servers and dependencies boot in an
  isolated git worktree serving the branch being changed. Approval is looking at the app.
- **A non-engineer never meets code.** No diffs, no file paths, no framework names in the answer.

**What is switched off here.** `becode.config.ts` sets `judge: false`, so the role policy is not
enforced on this install: this becode will implement a pricing, checkout or authentication change if
asked. And `disallowedTools` is empty at the operator's request, so the agent has the full harness
including `Bash` — which means "a pull request or nothing" is asked for in `agent/instructions.md`
rather than enforced at the tool layer. Both are deployment choices, and both are one line to
reverse. The mechanism itself is intact and tested (`npm run check:policy`, ten known allow/refuse
cases, which ignores the flag deliberately).

Taken together, and with the judge on: a coding agent a company can hand to someone who is not
allowed to break things, and be right about it. That is the product's claim; today it is a claim
about the design, not about this running install.

## Operating Context

- Runs locally on the user's own machine — one Next.js process, `npm run dev`, `localhost:4000`.
  No daemon and no hosted service. One container, and only one: MinIO on :9040, holding attachment
  bytes. becode runs without it; attachments are the only thing that fails.
- Authenticates with the user's Claude subscription token (`claude setup-token`), not an API key.
- Each task gets its own git worktree, so two chats can hold two branches at once. Apps keep their
  native ports because the target repo's env files and CORS allowlists are already written for them.
- Every pull request is filed as a Linear issue first; the issue identifier goes in the branch name,
  and Linear's GitHub integration moves the issue on open and on merge.
- Target repos are discovered rather than configured by hand: the agent works out a repo's boot
  recipe by reading it, and the person approves the result. Projects are stored in sqlite at
  `~/.becode/becode.db`.
- Two real target projects are configured on this machine today: `tix` and `rivero-scrapper`.

## Capabilities and Constraints

- **Requests are judged three times** *when the judge is on*: the request before work starts, every
  individual write before it reaches disk, and the real diff before a PR. The third also blocks on a
  human clicking approve, and a fourth, human-only confirmation guards adding a project. Those two
  human gates hold regardless of `judge`; the three verdicts do not.
- **The full harness, deliberately.** `Bash`, subagents, `WebSearch`, `WebFetch` and
  `AskUserQuestion` are all available — `disallowedTools` is empty because the operator asked for
  them. There is no sandbox: the agent edits a real checkout with host-native tools.
- **Paths are confined; commands are not.** Every `Read`, `Edit` and `Write` is resolved inside the
  task worktree and refused outside it, and a real `.env` is unreadable while no task exists. `Bash`
  takes a string rather than a path, so nothing at the tool layer confines it — inside a shell, the
  worktree boundary is a request in `agent/instructions.md`. `disallowedTools: ["Bash(git push:*)"]`
  is the one-line way to make the no-push rule structural again without giving up the shell.
- **Attachments** reach the model as content blocks, never files on disk: images, PDFs and text/code
  only, 5 files and 5MB each, 15MB a turn.
- **A design system is input, not invention.** Before any visual change the agent reads the target
  repo's tokens, theme config and component library, including its `PRODUCT.md`/`DESIGN.md` when it
  has them. New one-off colours, spacings or components are a defect.
- Node 24, Next.js 16 (preview), React 19, Tailwind 4, the Claude Agent SDK, shadcn/ui and beUI.
- **Undecided:** `POST /api/agent` is unauthenticated — fine on localhost, unresolved before becode
  is reachable by anyone else. Per-task port allocation is unresolved: `run_project` takes the ports
  over rather than allocating a block per task, because the backend's CORS allowlist names them.

## Brand Commitments

The product is named **becode**, lowercase, and refers to itself that way in its own interface and
in every answer the agent gives.

Its voice is the one written into `agent/instructions.md`: plain language, no diffs unless asked, no
framework names, no file paths in the main answer; one concrete question with options rather than a
paragraph of tradeoffs; and when something is not possible, what can be done instead.

No logo or mark exists. The only identity is the name itself, set lowercase in Geist at 48px on the
empty state — the one place display type appears in the product.

The visual system is documented in `DESIGN.md` (North Star: "The Glass Workshop") with its
machine-readable sidecar at `.impeccable/design.json`. Two anti-references are binding there and are
product commitments, not taste: becode must not look like an enterprise dashboard, and it must not
look like a developer IDE or terminal. The second follows directly from who this is for.

## Evidence on Hand

becode is built and working but **has not yet been used for real work by the person it is for**. It
is being prepared for handover.

There are therefore no shipped pull requests, no usage data, no testimonials, and no customers to
point to. Future work must not imply otherwise.

What does exist is real: two configured target repos, a role policy suite with ten known allow/refuse
cases (`npm run check:policy`), and the working loop end to end.

## Product Principles

1. **The boundary is mechanical, never persuasive.** Anything that decides what the person may ask
   for is enforced where the call is made, not in a prompt. A prompt is not a boundary. This is the
   principle new work is held to; it is not a description of the current install, which has the
   judge off and the shell on. Say which of the two you mean.
2. **Approval is looking, not reading.** Every decision the person is asked to make is put in front
   of them as the running product, or as plain language about it.
3. **The only way out is a pull request.** Nothing becode does can be irreversible on someone else's
   behalf. The worktree is disposable if a gate fails.
4. **The target repo is read, not assumed.** How a project boots, and how it looks, are discovered
   from that repo. Nothing about becode may hardcode one company's stack.
5. **One person, one role, one machine.** The constraint that makes the rest of it safe is that
   there is exactly one policy in force at a time, and someone chose it deliberately at install.

## Accessibility & Inclusion

The defining user need is the premise of the product: the person using it cannot read code and will
not read a diff. Any surface that requires understanding a diff, a file path, a stack trace or a
framework name to make a decision has failed them, regardless of how correct it is.

No formal accessibility standard has been established for becode's own interface.
