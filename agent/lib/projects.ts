/**
 * Target project configuration.
 *
 * What each repo is and how to boot it. Constraints do NOT live here — they are per role,
 * in plain English, under `roles/`. See `becode.config.ts` for which role this instance runs as.
 */

export type Project = {
  id: string;
  /** Absolute path to the git repo on this machine. */
  path: string;
  /** Branch PRs target. Never committed to directly. */
  baseBranch: string;
  /** Run once in each fresh worktree before the dev server. */
  install?: string;
  /** The dev server. `port` is the base — becode offsets it per task. */
  dev: { command: string; port: number };
  /** Anything the dev server needs up first (db, queue, worker). */
  services?: { name: string; command: string }[];
  /**
   * Files that define the look of the app — tokens, theme config, component index.
   * The agent reads these before any visual change instead of inventing values.
   */
  designSystem?: string[];
};

export const defineProjects = (projects: Project[]): Project[] => projects;
