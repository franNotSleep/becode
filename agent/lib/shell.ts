/**
 * The one shell command becode will not run.
 *
 * `disallowedTools: ["Bash(git push:*)"]` looks like it covers this and does not, for a reason
 * becode creates itself. The `PreToolUse` hook rewrites a `Bash` command to
 * `cd '<worktree>' || exit 1\n<command>` whenever the turn's cwd is not the worktree — which is
 * every call on the turn that ran `start_task`. Hooks run first and the deny rule matches the
 * *rewritten* string, whose prefix is now `cd`, so `git push` sails through on exactly the turn a
 * new task begins.
 *
 * So the refusal lives in the hook instead: it is the only surface that sees every command,
 * including the read-only ones the CLI auto-approves without ever consulting `canUseTool`.
 *
 * Be honest about the ceiling. This reads a string, and a shell can spell anything many ways —
 * `$(echo push)`, an alias, a script file. It stops the plain spelling and the one becode's own
 * rewrite produces. The boundary is still gate 3 and the fact that a worktree is disposable.
 */

/** Splits a command into the pieces a shell would run as separate commands. */
const segments = (command: string): string[] =>
  command
    .split(/\n|;|&&|\|\||\||&/)
    .map((part) => part.trim())
    .filter(Boolean);

/**
 * `git push` in any of the spellings worth naming: after a `cd` line, after leading env
 * assignments, with global flags such as `-C <dir>` between the verb and the subcommand, and with
 * `push` reached via an explicit `--git-dir`.
 */
export function pushesUpstream(command: string): boolean {
  return segments(command).some((segment) => {
    const tokens = segment.split(/\s+/).filter(Boolean);
    // Drop `VAR=value` prefixes — `GIT_DIR=… git push` is still a push.
    let index = 0;
    while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index += 1;
    const binary = tokens[index];
    if (binary === undefined) return false;
    // `git`, `/usr/bin/git`, and the `gh` escape hatch for the same thing.
    const name = binary.split("/").pop();
    if (name !== "git") return false;
    return tokens.slice(index + 1).includes("push");
  });
}

/** What the agent is told when it tries. Names the tool that exists for this, not just the refusal. */
export const PUSH_REFUSAL =
  "becode does not push branches from the shell. `open_pull_request` is the way work leaves this " +
  "machine: it judges the real diff, stops for a person to approve it, and opens the pull request.";
