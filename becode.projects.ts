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
    // Shared, fixed-port, and run from the source checkout — see `services` in projects.ts.
    // The backend's own .env pins it to :3031, which both apps already point at.
    services: [
      { name: "database", command: "docker compose -f apps/tixbackend/docker-compose.yml up -d" },
      { name: "backend", command: "pnpm dev:backend", port: 3031 },
    ],
    // Both apps' own dev scripts pin a port, which would ignore $PORT — bypass them.
    apps: [
      { name: "storefront", command: "pnpm --filter tixclient exec next dev -p $PORT", port: 3002 },
      { name: "vendor admin", command: "pnpm --filter tixvendor exec vite --port $PORT", port: 3000 },
    ],
    designSystem: [
      "apps/tixclient/components.json",
      "apps/tixclient/src/app/globals.css",
      "apps/tixclient/src/components/ui",
    ],
  },
]);
