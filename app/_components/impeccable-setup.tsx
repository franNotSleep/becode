"use client";

import type { ImpeccableState } from "@/agent/lib/impeccable";
import { CodeBlock } from "@/components/agents/code-block";

/**
 * What the person has to run so becode can work from their design system.
 *
 * Derived from the `start_task` tool row the client already holds rather than a new event — the
 * same read path `shippedLinks` uses for a shipped PR — so a reopened chat renders this too.
 *
 * The commands live here, not beside the detection in `agent/lib/impeccable.ts`: that module reads
 * the filesystem, and importing it into a client component would drag `node:fs` into the bundle.
 * Only the type crosses over, and a type is erased.
 */
export function impeccableState(name: string, output?: string): ImpeccableState | null {
  if (name !== "mcp__becode__start_task" || !output) return null;

  // Tool results are truncated at 2000 chars in transcript.ts, so a parse failure is normal here.
  try {
    const result: { impeccable?: { state?: ImpeccableState } } = JSON.parse(output);
    return result.impeccable?.state ?? null;
  } catch {
    return null;
  }
}

const SETUP_COMMAND = "npx impeccable install --scope=project --providers=claude";

/**
 * The installer only gitignores `.impeccable/config.local.json`, so everything carrying design
 * context is committable — and it has to be. `git worktree add` copies tracked files only, so
 * without this commit no task will ever see any of it.
 */
const COMMIT_COMMAND =
  "git add PRODUCT.md DESIGN.md .impeccable && git commit -m 'Add impeccable design context' && git push";

const Command = ({ code }: { readonly code: string }) => (
  <CodeBlock code={code} copyable language="bash" showLineNumbers={false} wrap />
);

export function ImpeccableSetup({ state }: { readonly state: ImpeccableState }) {
  if (state === "ready") return null;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border/80 bg-muted/30 p-3">
      <p className="text-muted-foreground text-sm">
        {state === "uncommitted"
          ? "This project has design guidelines, but they were never committed — so I can't see them. Commit them and I'll work from them from now on:"
          : "This project has no design guidelines for me to follow yet. Setting them up once means every change I make matches how the product already looks:"}
      </p>

      {state === "missing" ? (
        <>
          <Command code={SETUP_COMMAND} />
          <p className="text-muted-foreground text-sm">
            Then run <code className="text-foreground">/impeccable init</code> and{" "}
            <code className="text-foreground">/impeccable document</code> in that folder, and commit
            what they write:
          </p>
        </>
      ) : null}

      <Command code={COMMIT_COMMAND} />
    </div>
  );
}
