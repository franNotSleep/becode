"use client";

import { ArrowUpRightIcon, PaletteIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import type { ProjectDesign } from "@/agent/lib/impeccable";
import { CodeBlock } from "@/components/agents/code-block";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SETUP_COMMAND } from "./impeccable-setup";

/**
 * What becode knows about how a project looks, on the project row.
 *
 * The design system is the difference between a change that matches the product and one that
 * invents a colour, so whether becode has one is worth knowing *before* asking for work — not
 * discovered inside a chat after `start_task`, which is where it surfaced until now.
 *
 * The trigger is the answer rather than a label for it: four of the project's own colours when
 * there is a system to show, an outlined mark when there is not. The card behind it carries the
 * palette, the type and the one command that fixes whatever is missing.
 */
export function DesignSystemCard({
  design,
  project,
}: {
  readonly design: ProjectDesign;
  readonly project: string;
}) {
  const state = designState(design);
  const swatches = design.system?.colors.slice(0, 4) ?? [];

  return (
    <HoverCard closeDelay={120} openDelay={180}>
      <HoverCardTrigger asChild>
        {/* A link, not a button: the mark is the way into the full design system, and a middle
            click or a bookmark should reach it like any other page. The card is the peek. */}
        <Link
          aria-label={`${project} design system — ${state.label}`}
          className="grid shrink-0 place-items-center rounded-md p-1 text-muted-foreground/70 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          href={`/design/${project}`}
        >
          {swatches.length > 0 ? (
            <span aria-hidden="true" className="flex">
              {swatches.map((color) => (
                <span
                  className="-ml-1 size-2.5 rounded-full ring-1 ring-background first:ml-0"
                  key={color.name}
                  style={{ background: color.value }}
                />
              ))}
            </span>
          ) : state.blind ? (
            <TriangleAlertIcon aria-hidden="true" className="size-3.5 text-amber-500" strokeWidth={1.8} />
          ) : (
            <PaletteIcon aria-hidden="true" className="size-3.5 opacity-50" strokeWidth={1.6} />
          )}
        </Link>
      </HoverCardTrigger>

      <HoverCardContent align="start" className="w-80 space-y-3 p-3" side="right">
        <div className="space-y-0.5">
          <p className="font-medium text-sm">{design.system?.name ?? project}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {design.system?.description ?? state.detail}
          </p>
        </div>

        {design.system ? <SystemPreview system={design.system} /> : null}

        {state.command ? (
          <CodeBlock code={state.command} copyable language="bash" showLineNumbers={false} wrap />
        ) : null}

        <p className="flex items-center gap-1 text-muted-foreground text-xs">
          Open the design system
          <ArrowUpRightIcon aria-hidden="true" className="size-3" />
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function SystemPreview({ system }: { readonly system: NonNullable<ProjectDesign["system"]> }) {
  return (
    <div className="space-y-3">
      {system.colors.length > 0 ? (
        <Section title="Colours">
          <div className="flex flex-wrap gap-1.5">
            {system.colors.map((color) => (
              <span
                className="size-6 rounded-md border border-border/60"
                key={color.name}
                style={{ background: color.value }}
                title={`${color.name} · ${color.value}`}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {system.type.length > 0 ? (
        <Section title="Type">
          <ul className="space-y-1">
            {system.type.map((role) => (
              <li className="flex items-baseline justify-between gap-3" key={role.name}>
                <span
                  className="min-w-0 truncate text-sm"
                  style={{ fontFamily: role.family, fontWeight: role.weight }}
                >
                  {role.name}
                </span>
                <span className="shrink-0 truncate text-muted-foreground text-xs">
                  {role.family?.split(",")[0]}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {system.rounded.length > 0 ? (
        <Section title="Corners">
          <div className="flex items-end gap-1.5">
            {system.rounded.map((corner) => (
              <span
                className="size-6 border border-border bg-muted/60"
                key={corner.name}
                style={{ borderRadius: corner.value }}
                title={`${corner.name} · ${corner.value}`}
              />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

const Section = ({ children, title }: { children: React.ReactNode; title: string }) => (
  <div className="space-y-1.5">
    <p className="text-[0.6875rem] text-muted-foreground/70 uppercase tracking-wide">{title}</p>
    {children}
  </div>
);

/**
 * The four states, in the order the person has to fix them.
 *
 * Untracked outranks a missing DESIGN.md: `git worktree add` copies tracked files only, so an
 * uncommitted design system is one becode will never see, however complete it is.
 *
 * `blind` is the distinction the mark has to carry: work was done here and becode still cannot use
 * it. A project that was never set up is a decision nobody has made yet; one whose guidelines were
 * never committed is a decision that silently is not landing, and only the second is worth an
 * alert. Rendering both as the same faded icon made the one actionable state invisible.
 */
function designState(design: ProjectDesign): {
  ready: boolean;
  blind: boolean;
  label: string;
  detail: string;
  command?: string;
} {
  if (!design.installed && design.files.length === 0) {
    return {
      ready: false,
      blind: false,
      label: "none yet",
      detail:
        "No design guidelines here yet, so changes are made from what the code already does. Set them up once and every change will match the product:",
      command: SETUP_COMMAND,
    };
  }
  if (design.untracked.length > 0) {
    return {
      ready: false,
      blind: true,
      label: "not committed",
      detail:
        "These guidelines were never committed, so becode cannot see them while it works. Commit them:",
      // Named from what is actually untracked rather than the fixed list in `ImpeccableSetup`:
      // `git add` fails outright on a path that does not exist, and a project part-way through
      // setup — installed, PRODUCT.md written, DESIGN.md not yet — is the common case here.
      command:
        `git add ${design.untracked.join(" ")} && ` +
        `git commit -m 'Add impeccable design context' && git push`,
    };
  }
  if (!design.system) {
    return {
      ready: false,
      blind: true,
      label: "no design system recorded",
      detail:
        "Set up, but nothing describes how the product looks yet. Run /impeccable document in this project and commit what it writes.",
    };
  }
  return { ready: true, blind: false, label: "ready", detail: "becode works from these." };
}
