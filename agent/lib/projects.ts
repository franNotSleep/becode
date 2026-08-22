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
  /**
   * The surfaces a person actually looks at. Each gets a URL. `$PORT` in the command is
   * substituted; `port` is the base, offset by BECODE_PORT_OFFSET.
   */
  apps: { name: string; command: string; port: number }[];
  /**
   * Anything the apps need up first — db, queue, api. Run once, from the *source checkout*,
   * not the worktree: they are shared infrastructure on fixed ports, and they need the
   * untracked `.env` files that live there.
   */
  services?: { name: string; command: string }[];
  /**
   * Files that define the look of the app — tokens, theme config, component index.
   * The agent reads these before any visual change instead of inventing values.
   */
  designSystem?: string[];
};

export const defineProjects = (projects: Project[]): Project[] => projects;

/** Two becode instances on one machine collide on ports unless one is offset. */
export const PORT_OFFSET = Number(process.env.BECODE_PORT_OFFSET ?? 0);

/** Where each of a project's apps will be reachable once `run_project` has booted it. */
export const appUrls = (project: Project) =>
  project.apps.map((app) => {
    const port = app.port + PORT_OFFSET;
    return { name: app.name, port, url: `http://localhost:${port}` };
  });
