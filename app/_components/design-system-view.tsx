"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Streamdown } from "streamdown";
import { TriangleAlertIcon } from "lucide-react";
import type {
  DesignComponent,
  DesignSystem,
  ProjectDesign,
  Token,
  TypeRole,
} from "@/agent/lib/impeccable";
import { EASE_OUT, EASE_OUT_CSS } from "@/lib/ease";
import { cn } from "@/lib/utils";

const plugins = { cjk, code, math, mermaid };

/**
 * A project's design system, drawn in the project's own design language.
 *
 * The page adopts the target's paper, ink, faces and corners, so what the person reads *is* the
 * thing being described. becode's own chrome stays neutral above it, which is what keeps the two
 * identities from arguing: one frame, one world inside it.
 *
 * Every colour decision on this page is measured rather than assumed. A design system names its
 * colours whatever it likes — `oxblood-deep`, `surface-container-low` — so which one is the page
 * and which one is the text cannot be read off a key. `luminance` paints each value to a 1×1
 * canvas and reads the pixel back, which makes the browser the colour parser: hex, `rgb()`,
 * `hsl()`, `oklch()`, wide gamut and named colours all resolve, including formats this code has
 * never heard of. Swatch labels pick black or white by contrast ratio against their own field, so
 * a label is never the 3:1 grey that a fixed foreground would produce on half the palette.
 */
export function DesignSystemView({
  design,
  docs,
  project,
}: {
  readonly design: ProjectDesign;
  readonly docs: { path: string; text: string }[];
  readonly project: string;
}) {
  const system = design.system;
  const reduce = useReducedMotion() ?? false;

  // Every colour on this page is measured with a canvas, and a canvas needs a document. Computing
  // during render put that behind `typeof document === "undefined"` on the server, so the first
  // paint measured every colour as black: the page stayed becode's dark, and a label on #f6f6f6
  // came out white. Worse, the client then disagreed with the server about it — a hydration
  // mismatch on the styles that matter most here. Measuring after mount is the honest order, and
  // the transition it makes visible is the page adopting the project's identity, which is the idea.
  const [measured, setMeasured] = useState(false);
  useEffect(() => setMeasured(true), []);

  const world = useMemo(() => (measured ? deriveWorld(system) : NEUTRAL), [measured, system]);
  const labels = useMemo(
    () =>
      measured
        ? new Map((system?.colors ?? []).map((color) => [color.name, readable(color.value)]))
        : new Map<string, string>(),
    [measured, system],
  );

  const body = system?.type.find((role) => /body|text|base|paragraph/i.test(role.name));
  const display = system?.type[0];

  if (!system && docs.length === 0) {
    return (
      <main className="grid min-h-0 flex-1 place-items-center px-6">
        <p className="max-w-sm text-center text-muted-foreground text-sm leading-relaxed">
          {project} has no design guidelines yet, so becode works from what the code already does.
          Run <code className="text-foreground">npx impeccable install</code> in that folder, then{" "}
          <code className="text-foreground">/impeccable document</code>, and commit what they write.
        </p>
      </main>
    );
  }

  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto"
      style={{
        background: world.paper,
        color: world.ink,
        fontFamily: body?.family,
        transition: reduce
          ? undefined
          : `background-color 700ms ${EASE_OUT_CSS}, color 700ms ${EASE_OUT_CSS}`,
      }}
    >
      <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10 sm:py-24">
        <header className="mb-20">
          <h1
            className="text-balance"
            style={{
              fontFamily: display?.family,
              fontSize: display?.size ?? "clamp(2.5rem, 7vw, 4.5rem)",
              fontWeight: display?.weight ?? 400,
              letterSpacing: display?.letterSpacing,
              lineHeight: display?.lineHeight ?? 1.05,
            }}
          >
            {system?.name ?? project}
          </h1>
          {system?.description ? (
            <p className="mt-4 max-w-[46ch] text-pretty opacity-70" style={{ fontSize: "1.0625rem" }}>
              {system.description}
            </p>
          ) : null}
        </header>

        {system && system.colors.length > 0 ? (
          <Section muted={world.ink} title="Palette">
            <div className="grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 lg:grid-cols-4"
                 style={{ borderRadius: world.corner, background: hairline(world.ink) }}>
              {system.colors.map((color, index) => (
                <motion.div
                  animate={{ clipPath: "inset(0 0% 0 0)" }}
                  className="flex min-h-28 flex-col justify-end p-3"
                  initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }}
                  key={color.name}
                  style={{ background: color.value, color: labels.get(color.name) }}
                  transition={{ delay: reduce ? 0 : index * 0.04, duration: 0.5, ease: EASE_OUT }}
                >
                  {/* Held back until the field has been measured: a label drawn on a guess is a
                      label that can land white on #f6f6f6. */}
                  <span
                    className="font-medium text-sm transition-opacity duration-300"
                    style={{ opacity: labels.has(color.name) ? 1 : 0 }}
                  >
                    {color.name}
                  </span>
                  <span
                    className="font-mono text-[0.6875rem] opacity-70 transition-opacity duration-300"
                    style={{ opacity: labels.has(color.name) ? 0.7 : 0 }}
                  >
                    {color.value}
                  </span>
                </motion.div>
              ))}
            </div>
          </Section>
        ) : null}

        {system && system.type.length > 0 ? (
          <Section muted={world.ink} title="Type">
            <div className="space-y-10">
              {system.type.map((role) => (
                <TypeSpecimen ink={world.ink} key={role.name} role={role} />
              ))}
            </div>
          </Section>
        ) : null}

        {system && system.components.length > 0 ? (
          <Section muted={world.ink} title="Components">
            {/* A grid rather than a wrapping flex row: specimens are different heights — `card`
                carries its own 16px padding, `badge` is 20px tall — and in a flex row that pushed
                each label to wherever its own stage happened to end. Equal-height rows put the
                labels back on one line. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
              {system.components.map((component) => {
                const legible = measured ? contrastOf(component) : null;
                return (
                  <div className="flex flex-col justify-between gap-2" key={component.name}>
                    {/* A stage, not decoration: `button-outline` is paper-on-paper and `input` is
                        transparent, so on this page they would otherwise be invisible — which
                        would read as the page failing rather than as the component having no fill
                        of its own. The hairline is the project's own ink, not a grey. */}
                    <div
                      className="flex flex-1 items-center justify-center px-4 py-3"
                      style={{
                        border: `1px dashed ${hairline(world.ink, 0.16)}`,
                        borderRadius: world.corner,
                      }}
                    >
                      <span
                        className="inline-flex items-center justify-center whitespace-nowrap"
                        style={{
                          background: component.backgroundColor,
                          borderRadius: component.rounded,
                          color: component.textColor,
                          fontFamily: component.type?.family,
                          fontSize: component.type?.size,
                          fontWeight: component.type?.weight,
                          height: component.height,
                          letterSpacing: component.type?.letterSpacing,
                          padding: component.padding ?? "0.5rem 1rem",
                          width: component.width,
                        }}
                      >
                        {label(component.name)}
                      </span>
                    </div>
                    <span className="flex items-center gap-1.5 font-mono text-[0.6875rem]">
                      <span style={{ color: hairline(world.ink, 0.6) }}>{component.name}</span>
                      {legible !== null && legible < 4.5 ? (
                        // Drawn faithfully and flagged, never quietly corrected. tix declares
                        // `button-destructive` with its text the same colour as its background;
                        // a table of token values would have shown that as two tidy hex strings.
                        <span
                          className="inline-flex items-center gap-1"
                          style={{ color: "#d83b00" }}
                          title={`Text and background contrast at ${legible.toFixed(1)}:1 — below the 4.5:1 floor for body text.`}
                        >
                          <TriangleAlertIcon aria-hidden="true" className="size-3" />
                          {legible.toFixed(1)}:1
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>
        ) : null}

        {system && (system.rounded.length > 0 || system.spacing.length > 0) ? (
          <Section muted={world.ink} title="Measure">
            <div className="flex flex-wrap gap-10">
              {system.rounded.length > 0 ? (
                <Scale ink={world.ink} tokens={system.rounded}>
                  {(token) => (
                    <span
                      className="block size-14"
                      style={{
                        border: `1px solid ${hairline(world.ink, 0.25)}`,
                        borderRadius: token.value,
                      }}
                    />
                  )}
                </Scale>
              ) : null}
              {system.spacing.length > 0 ? (
                <Scale ink={world.ink} tokens={system.spacing}>
                  {(token) => (
                    <span className="flex h-14 items-center">
                      <span
                        className="block h-2"
                        style={{ background: hairline(world.ink, 0.35), width: token.value }}
                      />
                    </span>
                  )}
                </Scale>
              ) : null}
            </div>
          </Section>
        ) : null}

        {docs.map((doc) => (
          <Section key={doc.path} muted={world.ink} title={doc.path.split("/").pop() ?? doc.path}>
            {/* Streamdown styles inline code from becode's own tokens, which are dark — a black
                chip on tix's white page, becode's identity leaking into the world it is meant to
                be showing. Repainted from the project's palette instead. */}
            <div
              className={cn(
                "max-w-[68ch] leading-relaxed",
                "[&_a]:underline [&_a]:underline-offset-4",
                "[&_code]:!bg-[var(--doc-chip)] [&_code]:!text-[color:var(--doc-ink)]",
                "[&_code]:font-mono [&_code]:text-[0.875em]",
                "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:font-medium [&_h2]:text-xl",
                "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-medium",
                "[&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
                "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5",
                "[&>*:first-child]:mt-0",
              )}
              style={
                {
                  "--doc-chip": hairline(world.ink, 0.07),
                  "--doc-ink": world.ink,
                } as React.CSSProperties
              }
            >
              <Streamdown plugins={plugins}>{doc.text}</Streamdown>
            </div>
          </Section>
        ))}
      </div>
    </main>
  );
}

function Section({
  children,
  muted,
  title,
}: {
  readonly children: React.ReactNode;
  readonly muted: string;
  readonly title: string;
}) {
  return (
    <section className="mb-20">
      <h2
        className="mb-5 font-medium text-[0.6875rem] uppercase tracking-[0.12em]"
        style={{ color: hairline(muted, 0.55) }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Scale({
  children,
  ink,
  tokens,
}: {
  readonly children: (token: Token) => React.ReactNode;
  readonly ink: string;
  readonly tokens: Token[];
}) {
  return (
    <div className="flex flex-wrap items-end gap-5">
      {tokens.map((token) => (
        <div className="flex flex-col gap-2" key={token.name}>
          {children(token)}
          <span className="font-mono text-[0.6875rem]" style={{ color: hairline(ink, 0.6) }}>
            {token.name} · {token.value}
          </span>
        </div>
      ))}
    </div>
  );
}

const SPECIMEN = "The quick brown fox jumps over the lazy dog";

function TypeSpecimen({ ink, role }: { readonly ink: string; readonly role: TypeRole }) {
  return (
    <div>
      <p
        className="text-pretty"
        style={{
          fontFamily: role.family,
          fontSize: role.size,
          fontWeight: role.weight,
          letterSpacing: role.letterSpacing,
          lineHeight: role.lineHeight,
        }}
      >
        {SPECIMEN}
      </p>
      <p className="mt-2 font-mono text-[0.6875rem]" style={{ color: hairline(ink, 0.55) }}>
        {[role.name, role.family?.split(",")[0], role.weight, role.size].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}

/** `button-primary` → `Button primary`, so a specimen reads as a thing rather than a key. */
function label(name: string): string {
  const words = name.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// --- Measuring colour -------------------------------------------------------------------------

/**
 * Relative luminance of any CSS colour string, via a 1×1 canvas.
 *
 * The browser is the only colour parser that keeps up with CSS: `oklch()`, `color(display-p3 …)`,
 * `lab()`, `color-mix()` and whatever lands next all resolve here without this file learning them.
 * An unparseable value leaves the pre-filled black in place, which reads as "very dark" and is the
 * safe direction — a swatch label lands white on it.
 */
function luminance(color: string): number {
  if (typeof document === "undefined") return 0;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  context.fillStyle = "#000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * How legible a component's own text is on its own background, or `null` if it does not say.
 *
 * A transparent or undeclared background inherits the page, which this cannot rule on without
 * guessing what the component will sit on — so it reports nothing rather than a made-up number.
 */
function contrastOf(component: DesignComponent): number | null {
  const { backgroundColor: background, textColor: text } = component;
  if (!background || !text || background === "transparent") return null;
  return contrast(luminance(background), luminance(text));
}

/** Black or white on this field, whichever a reader can actually see. */
function readable(background: string): string {
  const l = luminance(background);
  return contrast(l, 0) >= contrast(l, 1) ? "#000000" : "#ffffff";
}

/** A tint of the ink, for rules and secondary text — never a grey the palette never chose. */
const hairline = (ink: string, alpha = 0.12) =>
  `color-mix(in oklab, ${ink} ${Math.round(alpha * 100)}%, transparent)`;

/**
 * Which colour is the page and which is the text.
 *
 * Names are hints, not answers — the schema says keys are the project's own words — so a name match
 * only breaks ties between measured candidates. The pair is then checked at 4.5:1 and abandoned
 * wholesale if it fails: a design system whose two extremes cannot carry body text is one this page
 * should not be inventing a compromise for, and becode's own surface is the honest fallback.
 */
function deriveWorld(system: DesignSystem | null): World {
  const corner = cardCorner(system);
  const colors = system?.colors ?? [];
  if (colors.length < 2 || typeof document === "undefined") {
    return { ...NEUTRAL, corner };
  }

  const measured = colors.map((color) => ({ ...color, l: luminance(color.value) }));
  const named = (pattern: RegExp) => measured.filter((color) => pattern.test(color.name));
  const lightest = [...measured].sort((a, b) => b.l - a.l);
  const darkest = [...measured].sort((a, b) => a.l - b.l);

  const paper = named(/paper|bg|background|surface|canvas|base|white|light/i)[0] ?? lightest[0];
  const ink = named(/ink|text|fg|foreground|body|black|dark/i)[0] ?? darkest[0];

  return contrast(paper.l, ink.l) >= 4.5
    ? { paper: paper.value, ink: ink.value, corner }
    : { paper: lightest[0].value, ink: darkest[0].value, corner };
}

type World = { paper: string; ink: string; corner: string };

/** becode's own surface, used until the palette has been measured and if it cannot be trusted. */
const NEUTRAL: World = {
  paper: "var(--background)",
  ink: "var(--foreground)",
  corner: "0.75rem",
};

/**
 * The radius to give a container on this page.
 *
 * Not the largest one the system declares: a scale almost always ends in a pill (`9999px`), and
 * applying that to a palette grid turns it into a circle — which is what the first render did.
 * The median of the numeric steps is the one a card would use, and the cap keeps a system with an
 * unusually generous scale from swallowing its own swatches.
 */
function cardCorner(system: DesignSystem | null): string {
  const steps = (system?.rounded ?? [])
    .map((token) => Number.parseFloat(token.value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (steps.length === 0) return "0.75rem";
  const median = steps[Math.floor((steps.length - 1) / 2)];
  const unit = system?.rounded[0]?.value.replace(/^[\d.]+/, "") || "px";
  return `min(${median}${unit}, 20px)`;
}
