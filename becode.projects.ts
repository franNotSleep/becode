/**
 * The repos becode can work on, and how to run each one.
 *
 * This is about *where* the code is, not *what may change* — constraints are per role, in
 * plain English, under `roles/`.
 *
 * This is the **seed**, not the record. `agent/lib/db.ts` inserts whatever is declared here the
 * first time the `projects` table is empty, and never again; after that the store is the record
 * and this file is inert. So it is empty on purpose: a path written here is a path from whichever
 * machine authored it, and `PATCH /api/projects/[id]` refuses to edit `id` and `path` — a wrong
 * one is unfixable short of deleting the database, which takes every chat with it.
 *
 * Add a project the way the product intends instead: the `+` beside Projects opens a folder
 * picker, the agent reads the repo and works out its boot recipe, and `propose_project` stops for
 * a person to approve it.
 */
import { defineProjects } from "./agent/lib/projects.ts";

export const projects = defineProjects([]);
