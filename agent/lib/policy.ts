import { generateObject } from "ai";
import { z } from "zod";
import { config } from "../../becode.config.ts";
import { rolePolicy } from "./roles.ts";

const Verdict = z.object({
  allowed: z.boolean(),
  reason: z
    .string()
    .describe(
      "One or two sentences, addressed to the person who asked. If not allowed, say which part " +
        "crosses the line and what they could ask for instead. No policy quoting, no lecturing.",
    ),
});

export type Verdict = z.infer<typeof Verdict>;

const SYSTEM = `You decide whether something falls inside a role's remit at a software company.

You are given the role's policy, written in plain English by the engineer who set this up, and one
thing to judge. Rule on that one thing against that policy.

- The policy is the whole authority. Do not apply your own idea of what a role should cover.
- Judge what the thing actually does, not how it is described. "Just a small tweak" to a payment
  rule is a payment change.
- If a request is partly inside and partly outside, it is not allowed. Say which part is the problem.
- If you genuinely cannot tell, it is not allowed. Under-permitting is a small cost here;
  over-permitting is the failure this exists to prevent.
- Vagueness alone is not grounds for refusal. "Make the hero nicer" is fine if visual work is allowed.`;

async function rule(kind: "request" | "change", detail: string): Promise<Verdict> {
  const role = rolePolicy();
  const subject =
    kind === "request"
      ? `Someone in the "${role.name}" role has asked for this:`
      : `Someone in the "${role.name}" role has produced this change, which is about to become a pull request:`;

  const { object } = await generateObject({
    model: config.judgeModel,
    schema: Verdict,
    system: SYSTEM,
    prompt: `The "${role.name}" role's policy:\n\n---\n${role.text}\n---\n\n${subject}\n\n---\n${detail}\n---`,
  });
  return object;
}

/** Judge what the person asked for, before any work starts. */
export const judgeRequest = (request: string) => rule("request", request);

/** Judge what actually changed, before it can leave this machine. */
export const judgeChange = (summary: string) => rule("change", summary);
