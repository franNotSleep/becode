import { LinearClient } from "@linear/sdk";

/**
 * Linear, for traceability only.
 *
 * becode files one issue per pull request, at PR time — never at `start_task`. An issue created
 * when a chat starts would be an outbound write to a shared workspace on the weakest gate becode
 * has (gate 1 judges the agent's *restatement* of the request), and every abandoned experiment
 * would leave one behind. By the time `open_pull_request` runs, gate 3 has judged the real diff
 * and a person has clicked approve.
 *
 * The issue is not linked to the PR by anything in this file. The identifier goes into the pushed
 * branch name and Linear's GitHub integration does the rest — that whole state machine (In
 * Progress on branch, In Review on PR, Done on merge) is a feature Linear already ships.
 *
 * ponytail: no client-side cache beyond the team/label ids, no retry, no queue. One person, one
 * workspace, a handful of PRs a day. If Linear is down the PR still opens — see `fileIssue`'s
 * caller in `agent/sdk/tools.ts`.
 */

/** The label every becode-filed issue carries, so the team can filter them out of triage. */
const LABEL = "becode";

let client: LinearClient | null = null;

// Lazy, like the same client in web/apps/tixqa/server/linear.ts: LinearClient throws at
// construction with no key, so building it at import would take becode down over an optional
// integration.
function linear(): LinearClient {
  if (!process.env.LINEAR_API_KEY) throw new Error("LINEAR_API_KEY is not set");
  return (client ??= new LinearClient({ apiKey: process.env.LINEAR_API_KEY }));
}

/** Whether becode is configured to file issues at all. Absence is not an error. */
export function hasLinear(): boolean {
  return Boolean(process.env.LINEAR_API_KEY);
}

export type Filed = { id: string; identifier: string; url: string };

/** The teams this token can see — for the picker in a project's settings. */
export async function listTeams(): Promise<{ key: string; name: string }[]> {
  const teams = await linear().teams({ first: 50 });
  return teams.nodes.map((team) => ({ key: team.key, name: team.name }));
}

/** Resolved once per team — a team and its `becode` label do not change under us. */
const resolved = new Map<string, { teamId: string; labelIds: string[] }>();

/**
 * Which team an issue is filed against.
 *
 * The project's (`Project.linearTeam`, picked in project settings), because a workspace has as
 * many teams as the company has and an issue filed against the wrong one is worse than none: the
 * identifier goes into the branch name, so the whole PR lands under it. This used to be
 * `nodes[0]` on the grounds that one person against one workspace has exactly one possible
 * answer — and every issue went to whichever team Linear happened to list first.
 *
 * Unset is only guessed when there is nothing to guess between. Otherwise it throws, and
 * `fileIssue`'s caller turns that into a warning on an open PR rather than a failure.
 */
export function pickTeam<T extends { key: string }>(teams: T[], key?: string): T {
  if (key) {
    const team = teams.find((node) => node.key === key);
    if (team) return team;
    throw new Error(`This Linear token sees no team "${key}". Pick one in the project's settings.`);
  }
  if (!teams.length) throw new Error("This Linear token can see no teams.");
  if (teams.length > 1) {
    throw new Error(
      `This Linear workspace has more than one team (${teams
        .map((node) => node.key)
        .join(", ")}). Choose the one to file against in the project's settings.`,
    );
  }
  return teams[0];
}

/** The team and its `becode` label, creating the label the first time. */
async function target(key?: string): Promise<{ teamId: string; labelIds: string[] }> {
  const cached = resolved.get(key ?? "");
  if (cached) return cached;

  const team = pickTeam((await linear().teams({ first: 50 })).nodes, key);
  const labels = await team.labels({ first: 250 });
  const existing = labels.nodes.find((label) => label.name === LABEL);
  const label =
    existing ??
    (await (
      await linear().createIssueLabel({ name: LABEL, teamId: team.id })
    ).issueLabel);

  const found = { teamId: team.id, labelIds: label ? [label.id] : [] };
  resolved.set(key ?? "", found);
  return found;
}

/**
 * File the issue for a change that is about to become a pull request.
 *
 * Unassigned and in the team's default state on purpose: an issue that appears at PR time is a
 * notification to whoever triages, not a work item someone still has to do. The GitHub integration
 * moves it from there.
 */
export async function fileIssue(input: {
  /** The PR title, which is already required to be in the user's words. */
  title: string;
  /** `Task.request` — what was actually asked for, before the agent's summary of what it did. */
  request: string;
  /** The PR body. */
  body: string;
  branch: string;
  projectId: string;
  /** `Project.linearTeam` — the team key this project's issues belong to. */
  teamKey?: string;
}): Promise<Filed> {
  const { teamId, labelIds } = await target(input.teamKey);

  // Everything a reviewer needs without the chat. The PR link is not written here — the branch
  // carries the identifier, so Linear's GitHub integration attaches the PR itself.
  const description = [
    "**Asked for**", "", input.request, "",
    "**What changed**", "", input.body, "",
    "---", "",
    `Project \`${input.projectId}\` · branch \`${input.branch}\` · filed by becode.`,
  ].join("\n");

  const payload = await linear().createIssue({ teamId, title: input.title, description, labelIds });
  const issue = await payload.issue;
  if (!issue) throw new Error("Linear accepted the issue but returned nothing.");

  return { id: issue.id, identifier: issue.identifier, url: issue.url };
}
