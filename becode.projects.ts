/**
 * The repos becode can work on, and how to run each one.
 *
 * This is about *where* the code is, not *what may change* — constraints are per role, in
 * plain English, under `roles/`.
 */
import { defineProjects } from "./agent/lib/projects.ts";

export const projects = defineProjects([
  {
    id: "tix",
    path: "/Users/frannotsleep/Dev/tixdo/web",
    baseBranch: "main",
    install: "pnpm install --frozen-lockfile",
    // The app's own `dev` script pins -p 3002, which would ignore the per-task port offset.
    dev: { command: "pnpm --filter tixclient exec next dev -p $PORT", port: 3002 },
    services: [],
    designSystem: [
      "apps/tixclient/components.json",
      "apps/tixclient/src/app/globals.css",
      "apps/tixclient/src/components/ui",
    ],
  },
]);
