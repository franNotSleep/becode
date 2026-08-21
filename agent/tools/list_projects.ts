import { defineTool } from "eve/tools";
import { z } from "zod";
import { projects } from "../../becode.projects.ts";
import { rolePolicy } from "../lib/roles.ts";

export default defineTool({
  description:
    "List the projects becode can work on, and the role this becode is running as. " +
    "Call this first if you are unsure which project the user means.",
  inputSchema: z.object({}),
  execute() {
    const role = rolePolicy();
    return {
      role: role.name,
      policy: role.text,
      projects: projects.map((p) => ({ id: p.id, baseBranch: p.baseBranch })),
    };
  },
});
