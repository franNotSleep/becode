import { findProject } from "@/agent/lib/db.ts";
import { pullLatest } from "@/agent/lib/git.ts";
import { chatFor } from "@/agent/lib/task.ts";
import { bootProject, stopProject } from "@/agent/sdk/tools.ts";

// Spawns and kills real child processes; nothing here is cacheable.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start or stop the project's servers, without going through the agent.
 *
 * Booting is not a product change, so the role policy has nothing to rule on — asking the agent to
 * "start the project" got refused by gate 1 for exactly that reason, which is the wrong answer to a
 * person who just wants to look at their app. The button is the answer instead.
 *
 * Apps run in the chat's worktree when it has a task, so the button shows the branch being changed;
 * with no task there is nothing to serve but the source checkout.
 *
 * Starting pulls first, so the person is looking at the latest base branch — the source checkout
 * only. A task's worktree is in-progress work, and merging into it would change the diff gate 3
 * judges. The agent's `run_project` does not pull: it runs after every edit.
 */
export async function POST(request: Request) {
  const { projectId, sessionId, action } = (await request.json()) as {
    projectId?: string;
    sessionId?: string;
    action?: "start" | "stop";
  };

  if (action === "stop") return Response.json({ stopped: stopProject() });

  if (!projectId) return Response.json({ message: "No project selected." }, { status: 400 });

  try {
    const project = findProject(projectId);
    const { task } = chatFor(sessionId);
    const pulled = await pullLatest(project.path, project.baseBranch);
    return Response.json({
      ...(await bootProject(project, task?.worktree ?? project.path, task?.branch)),
      pulled,
    });
  } catch (error) {
    return Response.json({ message: (error as Error).message }, { status: 500 });
  }
}
