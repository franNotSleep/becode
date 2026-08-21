/**
 * becode instance setup.
 *
 * This becode runs for one person in one role. Set that here, once, when you install it on
 * their machine. The role's plain-English policy in `roles/<role>.md` decides what they are
 * allowed to ask for.
 */
export const config = {
  /** Must match a file in `roles/` — e.g. "marketing" → roles/marketing.md */
  role: "marketing",

  /** The model that judges requests and changes against the role policy. Small and fast on purpose. */
  judgeModel: "anthropic/claude-haiku-4.5",
} as const;
