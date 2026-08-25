/**
 * Whether a target repo carries impeccable's design context, and whether a task can see it.
 *
 * Impeccable keeps two files at a project root — PRODUCT.md (product truth, from an interview) and
 * DESIGN.md (visual tokens and prose, generated from the repo's own code) — plus a token sidecar at
 * `.impeccable/design.json`. They are the design system this agent is supposed to work from.
 *
 * The third state is the reason this file exists. `git worktree add` copies **tracked** files only,
 * so a repo where someone ran the installer but never committed looks exactly like a repo that
 * never had impeccable at all — from inside the worktree, which is all a task ever sees. Checking
 * the source checkout too is what turns that silent nothing into "commit it".
 */
import fs from "node:fs";
import path from "node:path";

/** `ready` — the worktree has it. `uncommitted` — only the checkout does. `missing` — neither. */
export type ImpeccableState = "ready" | "uncommitted" | "missing";

export type ImpeccableContext = {
  state: ImpeccableState;
  /** Repo-relative paths that exist in the worktree, for the agent to read. */
  files: string[];
};

/**
 * Where impeccable looks, in its own order — project root first, then two fallback context dirs
 * (`context.mjs:44-45,129-169`). Product and design resolve independently: a repo may carry one and
 * not the other, and impeccable inherits them separately.
 */
const CANDIDATES = [
  ["PRODUCT.md", ".agents/context/PRODUCT.md", "docs/PRODUCT.md"],
  ["DESIGN.md", ".agents/context/DESIGN.md", "docs/DESIGN.md"],
  [".impeccable/design.json"],
];

/** The first candidate in each group that exists under `root`. */
const found = (root: string): string[] =>
  CANDIDATES.map((group) => group.find((rel) => fs.existsSync(path.join(root, rel)))).filter(
    (rel): rel is string => rel !== undefined,
  );

export function impeccableContext(worktree: string, checkout: string): ImpeccableContext {
  const files = found(worktree);
  if (files.length > 0) return { state: "ready", files };
  // Nothing in the worktree is only half the answer: the checkout says which of the two fixes below
  // the person actually needs.
  return { state: found(checkout).length > 0 ? "uncommitted" : "missing", files: [] };
}
