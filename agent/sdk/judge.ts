import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { config } from "../../becode.config.ts";
import { turnAttachments } from "../lib/attachments.ts";
import { rolePolicy } from "../lib/roles.ts";

export type Verdict = { allowed: boolean; reason: string };

const SYSTEM = `You decide whether something falls inside a role's remit at a software company.

You are given the role's policy, written in plain English by the engineer who set this up, and one
thing to judge. Rule on that one thing against that policy.

- The policy is the whole authority. Do not apply your own idea of what a role should cover.
- Judge what the thing actually does, not how it is described. "Just a small tweak" to a payment
  rule is a payment change.

{RULES}

Reply with nothing but a verdict in exactly this shape:

VERDICT: ALLOW
<one or two sentences addressed to the person who asked>

or

VERDICT: REFUSE
<one or two sentences addressed to the person who asked, saying which part crosses the line and
what they could ask for instead. No policy quoting, no lecturing.>`;

/**
 * Gate 1 rules on an ask, and an ask has changed nothing yet.
 *
 * This used to be judged like a change — refuse when unsure, refuse when partly outside — and it
 * refused "critique this, it doesn't feel intuitive" on the grounds that a critique *might* surface
 * behavioural fixes. That is a guess about work nobody has done, and it costs the person the one
 * thing gate 1 is cheap enough to give: a fast answer to a reasonable question. Every edit the
 * request leads to is judged on its own before it reaches disk, and the real diff is judged again
 * before it leaves the machine, so speculation buys nothing that those two do not already cover.
 */
const REQUEST_RULES = `You are judging a request, before any work has started. Nothing has been
written yet, and every edit this leads to is judged again, on its own text, before it reaches disk.

- Rule on what is being asked for, not on what it might lead to. A refusal needs the ask itself to
  be out of bounds, or to be undeliverable without going out of bounds. "This could pull in changes
  the policy does not allow" is not a reason — those changes are refused when they are attempted.
- Looking, reading, reviewing, critiquing, auditing, planning and advising change nothing. Allow
  them. The policy governs what may be changed, not what may be examined or discussed.
- Ambiguity is not grounds for refusal. If a request has a reading that sits inside the policy,
  take that reading and allow it. "Make the hero nicer" is fine if visual work is allowed.
- Refuse when the thing asked for is squarely outside the policy, or when a visual-sounding ask can
  only be delivered by changing behaviour underneath.`;

/** Gates 2 and 3 rule on work that exists. This is the last check, so it is the strict one. */
const CHANGE_RULES = `You are judging work that has already been done. Nothing after this stops it.

- If a change is partly inside and partly outside, it is not allowed. Say which part is the problem.
- If you genuinely cannot tell, it is not allowed. Under-permitting is a small cost here;
  over-permitting is the failure this exists to prevent.`;

/**
 * Ask the judge model to rule on one thing.
 *
 * No tools (`disallowedTools: ["*"]` strips every tool definition) and no setting sources, so the
 * judge cannot read the repo, and becode's own CLAUDE.md never leaks into its context. It sees the
 * role policy and the thing to judge, nothing else.
 *
 * A request also carries whatever the person attached. Without that, "do this" beside a screenshot
 * reading "make everything free" is judged as "do this". A change does not: gates 2 and 3 rule on
 * the diff, which says what it does on its own.
 */
async function rule(kind: "request" | "change", detail: string): Promise<Verdict> {
  const role = rolePolicy();
  const subject =
    kind === "request"
      ? `Someone in the "${role.name}" role has asked for this:`
      : `Someone in the "${role.name}" role has produced this change, which is about to become a pull request:`;

  const prompt = `The "${role.name}" role's policy:\n\n---\n${role.text}\n---\n\n${subject}\n\n---\n${detail}\n---`;
  const attached = kind === "request" ? turnAttachments.get() : [];

  let text = "";
  for await (const message of query({
    prompt: attached.length === 0 ? prompt : withAttachments(attached, prompt),
    options: {
      model: config.judgeModel,
      systemPrompt: SYSTEM.replace(
        "{RULES}",
        kind === "request" ? REQUEST_RULES : CHANGE_RULES,
      ),
      disallowedTools: ["*"],
      settingSources: [],
      maxTurns: 1,
    },
  })) {
    if (message.type === "result" && typeof (message as { result?: string }).result === "string") {
      text = (message as { result: string }).result;
    }
  }

  return parseVerdict(text);
}

/** Content blocks only exist in `query`'s streaming-input form. One message, then done. */
async function* withAttachments(
  blocks: ContentBlockParam[],
  text: string,
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: [...blocks, { type: "text", text }] },
    parent_tool_use_id: null,
  };
}

/**
 * A verdict the judge did not state is a refusal.
 *
 * The policy itself says "if you genuinely cannot tell, it is not allowed" — an unparseable reply
 * is that case, and failing open here would defeat the whole arrangement.
 */
export function parseVerdict(text: string): Verdict {
  // ponytail: regex over a VERDICT: line, not a schema — the OAuth token has no API access, so
  // generateObject is not available. Swap back if becode ever runs on an API key.
  // [\s\S] rather than the `s` flag — tsconfig targets ES2017.
  const m = /VERDICT:\s*(ALLOW|REFUSE)\s*\n?([\s\S]*)/i.exec(text);
  if (!m) {
    return {
      allowed: false,
      reason: "The policy check did not return a usable answer, so this is refused by default.",
    };
  }
  const reason = m[2].trim();
  return {
    allowed: m[1].toUpperCase() === "ALLOW",
    reason: reason.length > 0 ? reason : "No reason given.",
  };
}

/** Judge what the person asked for, before any work starts. */
export const judgeRequest = (request: string) => rule("request", request);

/** Judge what actually changed, before it can leave this machine. */
export const judgeChange = (summary: string) => rule("change", summary);
