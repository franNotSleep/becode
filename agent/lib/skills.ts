/**
 * The skills this becode exposes as slash commands.
 *
 * Read off disk rather than asked of the SDK: `supportedCommands()` is authoritative but costs a
 * CLI spawn, and it answers with 38 entries — the built-in `/usage`, `/recap` and friends alongside
 * becode's five. The plugin at `agent/` discovers `skills/<name>/SKILL.md` and registers each as
 * `becode:<name>` with the bare `<name>` as an alias, so the directory listing *is* the answer.
 *
 * Verified against a live session: five directories, five `becode:*` commands, aliases matching the
 * directory names exactly.
 */
import fs from "node:fs";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), "agent", "skills");

/** Skill names, without the leading slash and without the `becode:` namespace. */
export function agentSkills(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(SKILLS_DIR, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}
