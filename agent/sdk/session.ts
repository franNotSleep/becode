import fs from "node:fs/promises";
import path from "node:path";
import { query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { changedFiles, diff } from "../lib/git.ts";
import { rolePolicy } from "../lib/roles.ts";
import { resolveInWorktree, task } from "../lib/task.ts";
import { judgeChange } from "./judge.ts";
import { becodeTools, TOOL } from "./tools.ts";

const MAX_TURNS = Number(process.env.BECODE_MAX_TURNS ?? 120);

/** becode's own directory. Captured at import time, before any task changes what cwd means. */
const BECODE_ROOT = process.cwd();

/** Tools the model may use without a policy check. Reading is unrestricted; writing is not. */
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "TodoWrite"]);

/**
 * Harness plumbing, not work. `ToolSearch` loads deferred tool schemas; it never reaches
 * `canUseTool` because it cannot execute anything, and what it loads is still gated. Showing it
 * to a non-engineer is noise.
 */
const HIDDEN_TOOLS = new Set(["ToolSearch"]);

/** Built-in tools that write to disk. Each one is judged before it lands. */
const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; title: string; input: unknown }
  | { type: "tool-result"; id: string; ok: boolean; text: string }
  | { type: "approval"; id: string; title: string; parameters: unknown; reason: string }
  | { type: "approval-resolved"; id: string; approved: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

export function hasAuth(): boolean {
  return !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

export const AUTH_HINT =
  "No CLAUDE_CODE_OAUTH_TOKEN set — run `claude setup-token` and add it to .env.local";

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

/** instructions.md plus the role policy this instance runs under. Read fresh, so edits take effect. */
async function systemPrompt(): Promise<string> {
  const instructions = await fs.readFile(
    path.join(BECODE_ROOT, "agent", "instructions.md"),
    "utf8",
  );
  const role = rolePolicy();
  return `${instructions}\n\n===== The "${role.name}" role's policy =====\n\nThis is what the person you work for may ask for. You do not interpret it — a separate judge rules on every request and every change against it. It is here so you can set expectations honestly.\n\n${role.text}`;
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
export function run(
  message: string,
  sessionId: string | undefined,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const out = channel<AgentEvent>();
  const emit = out.push;

  if (!hasAuth()) {
    emit({ type: "error", message: AUTH_HINT });
    out.close();
    return out;
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
      return gateOpenPullRequest(toolUseID, input, emit, signal);
    }

    // Gate 2: every write, judged by what it actually does to the app.
    if (WRITE_TOOLS.has(toolName)) {
      const current = task.get();
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

    if (READ_TOOLS.has(toolName) || toolName.startsWith("mcp__becode__")) {
      return { behavior: "allow", updatedInput: input };
    }

    return { behavior: "deny", message: `${toolName} is not available to becode.` };
  };

  let lastSessionId: string | undefined;
  /** tool_use ids whose results should also stay out of the transcript. */
  const hiddenCalls = new Set<string>();

  void (async () => {
    try {
      const response = query({
        prompt: message,
        options: {
          cwd: task.get()?.worktree ?? BECODE_ROOT,
          systemPrompt: await systemPrompt(),
          mcpServers: { becode: becodeTools },
          // cwd is the target worktree, so this must be absolute: becode's own skills live here,
          // not in the repo being edited. `agent/` is the plugin root — skills/ is auto-discovered.
          plugins: [{ type: "local", path: path.join(BECODE_ROOT, "agent") }],
          // No allowedTools, no permissionMode — see the note above.
          disallowedTools: ["Bash", "WebSearch", "WebFetch", "Task", "AskUserQuestion"],
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
            emit({ type: "session", sessionId: id });
          }
          continue;
        }

        if (sdkMessage.type === "assistant") {
          const blocks = (sdkMessage.message.content as unknown as Record<string, unknown>[]) ?? [];
          for (const block of blocks) {
            if (block.type === "text" && String(block.text ?? "").trim()) {
              emit({ type: "delta", text: String(block.text) });
            } else if (block.type === "thinking" && String(block.thinking ?? "").trim()) {
              emit({ type: "reasoning", text: String(block.thinking) });
            } else if (block.type === "tool_use") {
              if (HIDDEN_TOOLS.has(String(block.name))) {
                hiddenCalls.add(String(block.id));
                continue;
              }
              emit({
                type: "tool",
                id: String(block.id),
                name: String(block.name),
                title: summarize(String(block.name), block.input),
                input: block.input,
              });
            }
          }
          continue;
        }

        if (sdkMessage.type === "user") {
          const blocks = (sdkMessage.message.content as unknown as Record<string, unknown>[]) ?? [];
          for (const block of blocks) {
            if (block.type === "tool_result") {
              if (hiddenCalls.has(String(block.tool_use_id))) continue;
              emit({
                type: "tool-result",
                id: String(block.tool_use_id),
                ok: block.is_error !== true,
                text: flatten(block.content).slice(0, 2000),
              });
            }
          }
        }
      }
      emit({ type: "done" });
    } catch (e) {
      emit({ type: "error", message: (e as Error).message });
    } finally {
      for (const [id, resolve] of pendingApprovals) {
        pendingApprovals.delete(id);
        resolve(false);
      }
      out.close();
    }
  })();

  return out;
}

/**
 * A push channel the consumer can drain while the producer is blocked.
 *
 * This matters: `canUseTool` stalls the SDK loop while it waits for a person to approve a pull
 * request, so the approval event has to reach the browser *before* the thing it is waiting on
 * resolves. Buffering events and flushing them between SDK messages would deadlock.
 */
function channel<T>() {
  const items: T[] = [];
  let waiting: ((result: IteratorResult<T>) => void) | null = null;
  let closed = false;

  return {
    push(value: T) {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value, done: false });
      } else {
        items.push(value);
      }
    },
    close() {
      closed = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined as never, done: true });
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (items.length > 0) {
            return Promise.resolve({ value: items.shift() as T, done: false });
          }
          if (closed) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise((resolve) => {
            waiting = resolve;
          });
        },
      };
    },
  };
}

/**
 * Gate 3, the one that binds. Reads what changed on disk rather than what anyone claimed, then
 * still waits for a person. Nothing leaves this machine without both.
 */
async function gateOpenPullRequest(
  toolUseID: string,
  input: Record<string, unknown>,
  emit: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<PermissionResult> {
  const current = task.get();
  if (!current) {
    return { behavior: "deny", message: "No task started — there is nothing to open a PR for." };
  }

  const { projects } = await import("../../becode.projects.ts");
  const project = projects.find((p) => p.id === current.projectId);
  if (project && current.branch === project.baseBranch) {
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
  const approved = await new Promise<boolean>((resolve) => {
    pendingApprovals.set(toolUseID, resolve);
    signal.addEventListener("abort", () => resolve(false), { once: true });
    emit({
      type: "approval",
      id: toolUseID,
      title: String(input.title ?? "Open pull request"),
      parameters: { branch: current.branch, files, ...input },
      reason: `Open a pull request on ${current.branch}? ${files.length} file(s) changed.`,
    });
  });
  pendingApprovals.delete(toolUseID);
  emit({ type: "approval-resolved", id: toolUseID, approved });

  return approved
    ? { behavior: "allow", updatedInput: input }
    : { behavior: "deny", message: "The user did not approve the pull request." };
}

function toController(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", () => controller.abort(), { once: true });
  return controller;
}

/** A tool row reads better titled by what it acted on than by the tool's own name. */
function summarize(name: string, input: unknown): string {
  const tool = name.replace(/^mcp__becode__/, "");
  if (input === null || typeof input !== "object") return tool;
  const record = input as Record<string, unknown>;
  for (const key of ["file_path", "pattern", "path", "projectId", "title", "request"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return `${tool} ${value.split("/").slice(-2).join("/")}`;
    }
  }
  return tool;
}

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === "object" && block && "text" in block ? String(block.text) : ""))
      .join("");
  }
  return "";
}
