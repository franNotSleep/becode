import { AgentChat } from "@/app/_components/agent-chat";
import { agentSkills } from "@/agent/lib/skills";

// A server component, so the composer's slash-command list costs no route and no fetch — the skills
// are files in this repo, read once when the page renders.
export default function Page() {
  return <AgentChat skills={agentSkills()} />;
}
