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
  judgeModel: "haiku",

  /**
   * Whether the role policy is enforced at all.
   *
   * `false` turns off all three policy verdicts — the request before work starts, every write
   * before it reaches disk, and the real diff before a pull request. `roles/<role>.md` stops
   * binding: this becode will take a request to change pricing, checkout or authentication and
   * implement it, because nothing is left to say no.
   *
   * What survives is everything that is not the judge. Writes are still confined to the task
   * worktree by `resolveInWorktree`, `Bash` is still absent from the tool surface, the read grant
   * still refuses a real `.env`, and a person still confirms the pull request by hand — so nothing
   * reaches a shared branch without someone clicking approve. The check that is gone is the one
   * that decided whether the change was theirs to ask for.
   *
   * `npm run check:policy` ignores this flag and exercises the judge directly, so the policy can
   * still be trusted the moment it is switched back on.
   */
  judge: false,
} as const;
