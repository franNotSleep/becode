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
- If a request is partly inside and partly outside, it is not allowed. Say which part is the problem.
- If you genuinely cannot tell, it is not allowed. Under-permitting is a small cost here;
  over-permitting is the failure this exists to prevent.
- Vagueness alone is not grounds for refusal. "Make the hero nicer" is fine if visual work is allowed.

Reply with nothing but a verdict in exactly this shape:

VERDICT: ALLOW
<one or two sentences addressed to the person who asked>

or

VERDICT: REFUSE
<one or two sentences addressed to the person who asked, saying which part crosses the line and
what they could ask for instead. No policy quoting, no lecturing.>`;

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
      systemPrompt: SYSTEM,
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
