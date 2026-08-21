import fs from "node:fs";
import path from "node:path";
import { config } from "../../becode.config.ts";

const ROLES_DIR = path.join(process.cwd(), "roles");

/** The plain-English policy this becode instance runs under. Read once at startup. */
export function rolePolicy(): { name: string; text: string } {
  const file = path.join(ROLES_DIR, `${config.role}.md`);
  if (!fs.existsSync(file)) {
    const available = fs
      .readdirSync(ROLES_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
    throw new Error(
      `becode.config.ts sets role "${config.role}", but roles/${config.role}.md does not exist. ` +
        `Available roles: ${available.join(", ") || "none"}.`,
    );
  }
  return { name: config.role, text: fs.readFileSync(file, "utf8").trim() };
}
