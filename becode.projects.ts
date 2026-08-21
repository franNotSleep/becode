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
    path: "/Users/frannotsleep/Dev/tixdo/tix", // ← point this at the real checkout
    baseBranch: "main",
    install: "pnpm install --frozen-lockfile",
    dev: { command: "pnpm dev", port: 3000 },
    services: [
      // { name: "postgres", command: "docker compose up -d db" },
    ],
    designSystem: ["tailwind.config.ts", "src/styles/globals.css", "src/components/ui"],
  },
]);
