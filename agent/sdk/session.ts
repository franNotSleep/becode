import fs from "node:fs/promises";
import path from "node:path";
import {
  query,
  tagSession,
  type PermissionResult,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { config } from "../../becode.config.ts";
import { turnAttachments } from "../lib/attachments.ts";
import { changedFiles, diff, WORKTREE_ROOT } from "../lib/git.ts";
import { rolePolicy } from "../lib/roles.ts";
import { appendEvents, findProject, moveEvents } from "../lib/db.ts";
import { projectPorts } from "../lib/projects.ts";
import { holders, release } from "../lib/ports.ts";
import { canRead } from "../lib/reads.ts";
import { type Chat, chatFor, rememberChat, resolveInWorktree } from "../lib/task.ts";
import { judgeChange } from "./judge.ts";
import { becodeTools, ownedPids, TOOL } from "./tools.ts";
import { assistantEvents, toolResultEvents } from "./transcript.ts";

const MAX_TURNS = Number(process.env.BECODE_MAX_TURNS ?? 120);

/** becode's own directory. Captured at import time, before any task changes what cwd means. */
const BECODE_ROOT = process.cwd();

/** Read-only tools. Not judged, but still confined to the worktree. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);

/**
 * The full harness, switched on deliberately.
 *
 * These were `disallowedTools` — stripped from the request so the model never saw them — and the
 * operator asked for them back. Each is allowed outright rather than judged: there is no path for
 * a path check to confine a shell command to, and half the point of `Task` is that a subagent goes
 * and does the thing.
 *
 * What survives: gate 2 still judges every `Edit`/`Write`, gate 3 still blocks
 * `open_pull_request` on a person, and `canUseTool` still sees subagent calls (`agentID` in its
 * options), so a `Task` child is gated exactly like its parent. What does not: `Bash` takes a
 * command string, not a path, so `resolveInWorktree` cannot reach it. Inside a shell the worktree
 * confinement and "a pull request or nothing" are what the prompt asks for, not what the tool
 * layer enforces.
 */
const FULL_ACCESS = new Set([
  "Bash",
  "BashOutput",
  "KillShell",
  // Both names: `disallowedTools` knows this one as `Task`, but it reaches the model — and this
  // callback — as `Agent`. Verified against a live turn; the SDK's own `.d.ts` uses both.
  "Task",
  "Agent",
  "TaskOutput",
  "TaskStop",
  "SendMessage",
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  "SlashCommand",
  "ToolSearch",
]);

/** Built-in tools that write to disk. Each one is judged before it lands. */
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);


/**
 * An attachment as the transcript keeps it: something the browser can fetch, never the bytes.
 *
 * `src` is `/api/attachments/<sha>` for anything becode stored, and a `data:` URL only on the
 * legacy replay path, where the base64 is all a pre-MinIO chat left behind.
 */
export type TranscriptFile = { name: string; mediaType: string; src: string };

/**
 * One question the agent wants answered, as `AskUserQuestion` states it.
 *
 * Trimmed from the tool's own input: the model may send 1-4 questions of 2-4 options each, and
 * `header` is the short chip it labels them with.
 */
export type AskQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

export type AgentEvent =
  | { type: "session"; sessionId: string }
  /** Replay only: the person's own turn. Live, the browser already has it — it typed it. */
  | { type: "user"; text: string; files: TranscriptFile[] }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; title: string; input: unknown }
  | { type: "tool-result"; id: string; ok: boolean; text: string }
  | { type: "approval"; id: string; tool: string; title: string; parameters: unknown; reason: string }
  | { type: "approval-resolved"; id: string; approved: boolean }
  /** The agent asked something. Answering is what unblocks the turn. */
  | { type: "question"; id: string; questions: AskQuestion[] }
  /** Question text → the person's answer. Empty when they let it lapse. */
  | { type: "question-answered"; id: string; answers: Record<string, string> }
  | { type: "done" }
  | { type: "error"; message: string };

export function hasAuth(): boolean {
  return !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

export const AUTH_HINT =
  "No CLAUDE_CODE_OAUTH_TOKEN set — run `claude setup-token` and add it to .env.local";

/**
 * Say it out loud, once per process.
 *
 * A becode with the judge off looks identical to one with it on: the same chat, the same approval
 * card before a pull request. The difference is that nothing is deciding whether a request was
 * this role's to make. That is not a state to discover from a diff.
 */
if (!config.judge) {
  console.warn(
    `becode: the role policy (roles/${config.role}.md) is NOT enforced — ` +
      "`judge: false` in becode.config.ts. Requests and changes are not checked against it.",
  );
}

/**
 * Pull requests waiting on a person.
 *
 * `canUseTool` is async, so gate 3's human confirmation is just an awaited promise. The approve
 * route resolves it. Keyed by toolUseID, which is unique per tool call.
 */
const pendingApprovals = new Map<string, (approved: boolean) => void>();

export function resolveApproval(id: string, approved: boolean): boolean {
  const resolve = pendingApprovals.get(id);
  if (!resolve) return false;
  pendingApprovals.delete(id);
  resolve(approved);
  return true;
}

/**
 * Questions waiting on a person — the same trick as `pendingApprovals`, a different answer.
 *
 * `AskUserQuestion` is not run by becode: the CLI executes it and asks its host to render the
 * questions, through a `request_user_dialog` control request. Until becode declared it could
 * render them the CLI failed closed, answered its own dialog, and the agent was told "The user
 * did not answer the questions" without anyone ever being asked.
 */
const pendingQuestions = new Map<string, (answers: Record<string, string> | null) => void>();

export function resolveQuestion(id: string, answers: Record<string, string> | null): boolean {
  const resolve = pendingQuestions.get(id);
  if (!resolve) return false;
  pendingQuestions.delete(id);
  resolve(answers);
  return true;
}

/**
 * instructions.md, the role policy, and what this chat is already about. Read fresh, so edits
 * take effect.
 *
 * The scope line matters: a chat opened on a project in the sidebar knows its project before a
 * word is typed, but the only other place that shows is `list_projects` — a tool the agent has no
 * reason to call when the request is clear. Without this it asks "which project is this in?" about
 * a chat whose header says `becode · tix`.
 */
async function systemPrompt(chat: Chat): Promise<string> {
  const instructions = await fs.readFile(
    path.join(BECODE_ROOT, "agent", "instructions.md"),
    "utf8",
  );
  const role = rolePolicy();
  const scope = chat.projectId
    ? `\n\n===== This chat =====\n\nIt is about the project "${chat.projectId}". The person opened it there, so do not ask which project or repo anything belongs to — you already know. Call \`start_task\` without a \`projectId\`.`
    : chat.discoveryRoot
      ? `\n\n===== This chat =====\n\nThe person pointed you at ${chat.discoveryRoot} to add it as a project. Work out how it boots and call \`propose_project\`.`
      : "";
  return `${instructions}\n\n===== The "${role.name}" role's policy =====\n\nThis is what the person you work for may ask for. You do not interpret it — a separate judge rules on every request and every change against it. It is here so you can set expectations honestly.\n\n${role.text}${scope}`;
}

/** What the judge sees for one edit: where it lands, and what it actually does. */
function describeEdit(input: Record<string, unknown>, worktree: string): string {
  const target = String(input.file_path ?? input.notebook_path ?? "");
  const rel = path.relative(worktree, path.resolve(worktree, target)) || target;
  const cap = (value: unknown, limit = 2000) => String(value ?? "").slice(0, limit);

  if (typeof input.content === "string") {
    return `Writing \`${rel}\`.\n\nNew contents:\n${cap(input.content, 4000)}`;
  }
  if (Array.isArray(input.edits)) {
    const edits = input.edits
      .map((e, i) => {
        const edit = e as Record<string, unknown>;
        return `[${i + 1}] replacing:\n${cap(edit.old_string, 800)}\nwith:\n${cap(edit.new_string, 800)}`;
      })
      .join("\n\n");
    return `Editing \`${rel}\`.\n\n${edits}`;
  }
  return `Editing \`${rel}\`.\n\nReplacing:\n${cap(input.old_string)}\n\nWith:\n${cap(input.new_string)}`;
}

/**
 * Run one turn and stream events.
 *
 * Deliberately passes no `allowedTools` and no `permissionMode`: an auto-approved tool never
 * reaches `canUseTool`, which would silently skip the policy check. The only way to narrow the
 * surface here is `disallowedTools`, which removes a tool's definition outright.
 */
export type RunInput = {
  message: string;
  attachments: ContentBlockParam[];
  /** The same attachments already in object storage, as the transcript will remember them. */
  files: TranscriptFile[];
  sessionId?: string;
  /** Set when the chat was opened on a project in the sidebar, before anything was typed. */
  projectId?: string;
  /** Set when the person pointed becode at a repo to add. See the read grant in `canUseTool`. */
  discoveryPath?: string;
  /** Stopped only on purpose: `POST /api/agent/stop`, never a browser that went away. */
  signal: AbortSignal;
  /**
   * Where every event goes, with the `messages` row it landed on — `-1` before there is a session
   * to write against. Synchronous on purpose: an approval event has to reach the browser *before*
   * the `canUseTool` that is about to block on it, which is why this is a call and not a queue.
   */
  sink: (event: AgentEvent, storedId: number) => void;
};

export async function run({
  message,
  attachments,
  files,
  sessionId,
  projectId,
  discoveryPath,
  signal,
  sink,
}: RunInput): Promise<void> {
  /**
   * Every event goes to the subscribers and to sqlite, which is the whole point of one chokepoint.
   *
   * Buffered until a session id is known — a brand new chat has no row to write against until the
   * init message reports one, and tool calls always come after init. Written per event rather than
   * once at the end so a stopped turn keeps what it already produced.
   */
  let storeId: string | undefined = sessionId;
  const pending: AgentEvent[] = [];
  /** The row this event landed on. `-1` while there is still nothing to write against. */
  const keep = (event: AgentEvent): number => {
    pending.push(event);
    if (!storeId) return -1;
    // This event is the last of the batch, so the last id back is its own.
    const ids = appendEvents(storeId, pending.splice(0));
    return ids[ids.length - 1];
  };
  const emit = (event: AgentEvent) => sink(event, keep(event));

  // This chat's state. A resumed chat finds the worktree it already has; a new one starts empty.
  const chat: Chat = chatFor(sessionId);
  if (projectId) chat.projectId = projectId;
  if (discoveryPath) chat.discoveryRoot = path.resolve(discoveryPath);

  // Gate 1 reads these from here: the ask may live in the screenshot rather than the typed text.
  turnAttachments.set(attachments);

  // Kept, not emitted: live, the browser already rendered this — it typed it. `user` events exist
  // for replay, and replay is now this table rather than a walk of the SDK's transcript.
  keep({ type: "user", text: message, files });

  if (!hasAuth()) {
    emit({ type: "error", message: AUTH_HINT });
    return;
  }

  /**
   * Fail closed.
   *
   * A `canUseTool` that throws does not block the call — the tool runs anyway. So a network blip
   * inside the judge would silently become an approval, which is the exact failure this whole
   * arrangement exists to prevent. Every path out of `decide` is a returned verdict.
   */
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    options: { toolUseID: string },
  ): Promise<PermissionResult> => {
    try {
      return await decide(toolName, input, options);
    } catch (e) {
      return {
        behavior: "deny",
        message: `The policy check failed (${(e as Error).message}), so this is refused. Tell the user.`,
      };
    }
  };

  const decide = async (
    toolName: string,
    input: Record<string, unknown>,
    { toolUseID }: { toolUseID: string },
  ): Promise<PermissionResult> => {
    // Gate 3: the real diff, judged against what was originally asked for, then a person.
    if (toolName === TOOL.openPullRequest) {
      return gateOpenPullRequest(chat, toolUseID, input, emit, signal);
    }

    // Adding a project is setup, not product work: the role policy has nothing to say about it,
    // so this is the one gate that is a person alone. The path must be the folder they picked.
    if (toolName === TOOL.proposeProject) {
      const proposed = (input.project ?? {}) as { id?: unknown; path?: unknown };
      if (!chat.discoveryRoot) {
        return { behavior: "deny", message: "No repo was picked to add. Ask the user for one." };
      }
      if (path.resolve(String(proposed.path ?? "")) !== chat.discoveryRoot) {
        return {
          behavior: "deny",
          message: `The project path must be ${chat.discoveryRoot} — the folder the user picked.`,
        };
      }
      const approved = await askPerson(toolUseID, emit, signal, {
        tool: "propose_project",
        title: `Add "${String(proposed.id ?? "project")}"`,
        parameters: input.project,
        reason: `Add ${chat.discoveryRoot} as a project becode can work on?`,
      });
      return approved
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: "The user did not add this project." };
    }

    // A busy app port is a dead end otherwise: run_project fails with EADDRINUSE and the agent
    // retries forever, because the only thing it can stop is what this becode started. Whatever
    // else is there may be something the person wants, so becode asks rather than killing.
    if (toolName === TOOL.runProject) {
      const blocked = await foreignHolders(chat);
      if (blocked.length > 0) {
        const list = blocked
          .map((b) => `:${b.port} — ${b.holders.map((h) => `${h.command} (pid ${h.pid})`).join(", ")}`)
          .join("\n");
        const approved = await askPerson(toolUseID, emit, signal, {
          tool: "run_project",
          title: `Free port${blocked.length > 1 ? "s" : ""} ${blocked.map((b) => b.port).join(", ")}`,
          parameters: { holding: list },
          reason:
            `These ports are taken by something becode did not start — most likely a leftover ` +
            `from an earlier run. Stop them so the app can boot?\n${list}`,
        });
        if (!approved) {
          return {
            behavior: "deny",
            message:
              `The user left these running, so the app cannot boot:\n${list}\n` +
              `Tell them, and do not retry run_project until they have freed the port.`,
          };
        }
        for (const { port, holders: found } of blocked) {
          if (!(await release(port, found.map((h) => h.pid)))) {
            return {
              behavior: "deny",
              message: `Port ${port} is still busy after stopping what was there. Tell the user.`,
            };
          }
        }
      }
      return { behavior: "allow", updatedInput: input };
    }

    /**
     * The agent's own questions, answered by the person rather than by the CLI.
     *
     * becode does not run this tool — the CLI does, and it reads the answers back out of its own
     * input. With a terminal it renders the questions itself, through the permission prompt; the
     * SDK's equivalent of that prompt is this callback, so this is the only place a host can get
     * in front of them. Allowing the call *without* answers is exactly what produced "The user did
     * not answer the questions" for every question becode had ever asked.
     *
     * `updatedInput` with an `answers` map keyed by question text is the shape the CLI's own
     * renderer sends. Values are the option's label verbatim, or free text; multi-select answers
     * are comma-separated.
     */
    if (toolName === "AskUserQuestion") {
      const questions = (Array.isArray(input.questions) ? input.questions : []) as AskQuestion[];
      if (questions.length === 0) return { behavior: "allow", updatedInput: input };

      const answers = await askQuestions(toolUseID, emit, signal, questions);
      // No answer is allowed through unchanged, so the tool gives the CLI's own "nobody answered"
      // result and the agent asks again in prose rather than the turn dying here.
      return { behavior: "allow", updatedInput: answers ? { ...input, answers } : input };
    }

    // Gate 2: every write, judged by what it actually does to the app.
    if (WRITE_TOOLS.has(toolName)) {
      const current = chat.task;
      if (!current) {
        return { behavior: "deny", message: "No task started. Call start_task first." };
      }
      const target = String(input.file_path ?? input.notebook_path ?? "");
      try {
        resolveInWorktree(current.worktree, target);
      } catch (e) {
        return { behavior: "deny", message: (e as Error).message };
      }
      const verdict = await judgeChange(describeEdit(input, current.worktree));
      return verdict.allowed
        ? { behavior: "allow", updatedInput: input }
        : {
            behavior: "deny",
            message: `${verdict.reason} Tell the user this, and do not try another route.`,
          };
    }

    // Reading is unrestricted *inside the worktree* — and nowhere else. Without this, an absolute
    // path walks straight out of the target repo and into becode's own source, including
    // .env.local. The model declining to do so is not a boundary; this is.
    if (toolName === "TodoWrite") return { behavior: "allow", updatedInput: input };

    if (READ_TOOLS.has(toolName)) {
      const verdict = canRead(chat, toolName, input.file_path ?? input.path);
      return verdict.allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: verdict.message };
    }

    if (toolName.startsWith("mcp__becode__")) {
      return { behavior: "allow", updatedInput: input };
    }

    // Taking a tool out of `disallowedTools` is only half of it: everything here defaults to deny,
    // so a tool the model can finally see would still be refused at the gate.
    if (FULL_ACCESS.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    return { behavior: "deny", message: `${toolName} is not available to becode.` };
  };

  let lastSessionId: string | undefined;
  /** A session id reported this run that still needs the `becode` tag. See the tagging note below. */
  let untagged: string | undefined;
  /** tool_use ids whose results should also stay out of the transcript. */
  const hiddenCalls = new Set<string>();

  try {
    const response = query({
      // A plain string when there is nothing attached — the path that has always worked. Blocks
      // only exist in the streaming-input form, so that form is used only when there are some.
      prompt: attachments.length === 0 ? message : oneUserMessage(attachments, message),
      options: {
        // Never becode's own directory: cwd is fixed when the query starts, so on the turn that
        // calls start_task there is no worktree yet, and anything relative would resolve into
        // becode's source. WORKTREE_ROOT is inert — start_task returns the absolute path to use.
        cwd:
          chat.task?.worktree ??
          chat.discoveryRoot ??
          (chat.projectId ? findProject(chat.projectId).path : WORKTREE_ROOT),
        systemPrompt: await systemPrompt(chat),
        mcpServers: { becode: becodeTools(chat) },
        // cwd is the target worktree, so this must be absolute: becode's own skills live here,
        // not in the repo being edited. `agent/` is the plugin root — skills/ is auto-discovered.
        plugins: [{ type: "local", path: path.join(BECODE_ROOT, "agent") }],
        // No allowedTools, no permissionMode — see the note above. Empty by choice: the operator
        // wants the whole harness. Narrowing it again is one entry here — a scoped rule like
        // `Bash(git push:*)` blocks only what it names — and `FULL_ACCESS` above is the matching
        // half, since a tool has to pass both to run.
        disallowedTools: [],
        // Load no settings files. A `permissions.allow` rule in the *target repo's*
        // .claude/settings.json would auto-approve tools before canUseTool ever sees them —
        // and the target repo is not becode's trust boundary.
        settingSources: [],
        // Claude Code's bundled skills are written for a developer at a terminal — `run` and
        // `code-review` would compete with run_project and with becode's actual loop. Only the
        // becode plugin's four skills should be routable. Plugins are unaffected by this.
        settings: { disableBundledSkills: true },
        canUseTool,
        maxTurns: MAX_TURNS,
        resume: sessionId,
        abortController: toController(signal),
      },
    });

    for await (const sdkMessage of response) {
      // Every system message carries session_id, not just the init one — emit on change only.
      if (sdkMessage.type === "system" && "session_id" in sdkMessage) {
        const id = String(sdkMessage.session_id);
        if (id !== lastSessionId) {
          lastSessionId = id;
          rememberChat(chat, id);
          untagged = id;
          // A chat that gets a new id (a fork, a compaction) keeps its history: the rows move
          // with it, or everything before this point becomes unreachable from the sidebar.
          if (storeId && storeId !== id) moveEvents(storeId, id);
          storeId = id;
          emit({ type: "session", sessionId: id });
        }
        continue;
      }

      if (sdkMessage.type === "assistant") {
        for (const event of assistantEvents(sdkMessage.message.content, hiddenCalls)) emit(event);
        continue;
      }

      if (sdkMessage.type === "user") {
        for (const event of toolResultEvents(sdkMessage.message.content, hiddenCalls)) emit(event);
      }
    }
    emit({ type: "done" });
  } catch (e) {
    // A stop is not a failure, and the SDK's own abort text reads like one to the person who
    // pressed the button.
    emit({
      type: "error",
      message: signal.aborted ? "You stopped this turn." : (e as Error).message,
    });
  } finally {
    // How the sidebar tells becode's chats apart from the terminal sessions living in the same
    // repo — a chat that never starts a task sits on the project's own branch and is otherwise
    // indistinguishable. Tagged at the *end*: on the init message the CLI has not written the
    // session file yet, and tagSession silently finds nothing to tag.
    if (untagged) await tagSession(untagged, "becode").catch(() => undefined);
    for (const [id, resolve] of pendingApprovals) {
      pendingApprovals.delete(id);
      resolve(false);
    }
    // A question nobody got to before the turn ended. Left in the map it would strand the next
    // turn's answer on a promise no one is waiting on.
    for (const [id, resolve] of pendingQuestions) {
      pendingQuestions.delete(id);
      resolve(null);
    }
  }
}

/**
 * Gate 3, the one that binds. Reads what changed on disk rather than what anyone claimed, then
 * still waits for a person. Nothing leaves this machine without both.
 */
async function gateOpenPullRequest(
  chat: Chat,
  toolUseID: string,
  input: Record<string, unknown>,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<PermissionResult> {
  const current = chat.task;
  if (!current) {
    return { behavior: "deny", message: "No task started — there is nothing to open a PR for." };
  }

  const project = findProject(current.projectId);
  if (current.branch === project.baseBranch) {
    return {
      behavior: "deny",
      message: `Refusing to push to the base branch ${project.baseBranch}.`,
    };
  }

  const files = await changedFiles(current.worktree);
  if (files.length === 0) {
    return {
      behavior: "deny",
      message: "Nothing changed in this worktree — there is no PR to open.",
    };
  }

  const verdict = await judgeChange(
    `Originally asked for: ${current.request}\n\nFiles changed:\n${files.join("\n")}\n\n` +
      `Diff:\n${await diff(current.worktree)}`,
  );
  if (!verdict.allowed) {
    return {
      behavior: "deny",
      message:
        `${verdict.reason} The change stays in the worktree and does not become a pull request. ` +
        `Tell the user what happened.`,
    };
  }

  // Passed the policy; a person still confirms the outward-facing action.
  const approved = await askPerson(toolUseID, emit, signal, {
    tool: "open_pull_request",
    title: String(input.title ?? "Open pull request"),
    parameters: { branch: current.branch, files, ...input },
    reason: `Open a pull request on ${current.branch}? ${files.length} file(s) changed.`,
  });

  return approved
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "The user did not approve the pull request." };
}

/**
 * The streaming-input form of `prompt`, used for exactly one message.
 *
 * `query` takes `string | AsyncIterable<SDKUserMessage>`, and only the second carries content
 * blocks. The generator yields once and returns, so the turn runs and ends as it does for a
 * string. `SDKUserMessage` requires only these three fields; `session_id` is set by the CLI.
 */
async function* oneUserMessage(
  blocks: ContentBlockParam[],
  text: string,
): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: [...blocks, { type: "text", text }] },
    parent_tool_use_id: null,
  };
}

/**
 * Ports held by something this becode did not start — apps, and services that declare one.
 *
 * Its own children are not reported: `run_project` already hands the ports over between chats.
 * What is left is a leftover from a previous becode, or the person's own dev server.
 */
async function foreignHolders(
  chat: Chat,
): Promise<{ port: number; holders: Awaited<ReturnType<typeof holders>> }[]> {
  if (!chat.task) return [];
  const ours = new Set(ownedPids());
  const found = await Promise.all(
    projectPorts(findProject(chat.task.projectId)).map(async (port) => ({
      port,
      // By process group, not pid: becode tracks the shell it spawned, and the listener is that
      // shell's grandchild. Matching on pid alone had becode offering to kill its own apps.
      holders: (await holders(port)).filter((h) => !ours.has(h.pid) && !ours.has(h.pgid)),
    })),
  );
  return found.filter((entry) => entry.holders.length > 0);
}

/**
 * Park on a person.
 *
 * `canUseTool` is async, so waiting for a human is just an awaited promise; the approve route
 * resolves it by tool_use id. An abort resolves it as a refusal rather than leaving it hanging.
 */
/**
 * Put the agent's questions in front of the person and wait.
 *
 * `null` back means nobody answered — the turn was aborted, or the CLI's dialog deadline is about
 * to pass. The caller turns that into `{behavior:"cancelled"}`, which is the CLI's own default and
 * lands the agent back where it was before any of this: told that nobody answered.
 */
async function askQuestions(
  id: string,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
  questions: AskQuestion[],
): Promise<Record<string, string> | null> {
  const answers = await new Promise<Record<string, string> | null>((resolve) => {
    pendingQuestions.set(id, resolve);
    signal.addEventListener("abort", () => resolve(null), { once: true });
    emit({ type: "question", id, questions });
  });
  pendingQuestions.delete(id);
  emit({ type: "question-answered", id, answers: answers ?? {} });
  return answers;
}

async function askPerson(
  toolUseID: string,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
  ask: { tool: string; title: string; parameters: unknown; reason: string },
): Promise<boolean> {
  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(toolUseID, resolve);
    signal.addEventListener("abort", () => resolve(false), { once: true });
    emit({ type: "approval", id: toolUseID, ...ask });
  });
  pendingApprovals.delete(toolUseID);
  emit({ type: "approval-resolved", id: toolUseID, approved });
  return approved;
}

function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

