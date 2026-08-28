---
name: becode
description: A quiet workshop wall around someone else's running product.
colors:
  background: "oklch(0.971 0 0)"
  foreground: "oklch(0.16 0 0)"
  card: "oklch(1 0 0)"
  muted: "oklch(0.94 0 0)"
  muted-foreground: "oklch(0.6 0 0)"
  border: "oklch(0.916 0 0)"
  primary: "oklch(0.19 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  accent-skill: "oklch(0.58 0.1 210)"
  status-fail: "oklch(0.586 0.253 17.585)"
  status-live: "oklch(0.596 0.145 163.225)"
  status-info: "oklch(0.546 0.245 262.881)"
  status-warn: "oklch(0.666 0.179 58.318)"
  destructive: "oklch(0.577 0.245 27.325)"
typography:
  display:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: "normal"
  overline:
    fontFamily: "Geist, Geist Fallback, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.12em"
  code:
    fontFamily: "Geist Mono, Geist Mono Fallback, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  "2xl": "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "1.5": "6px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
components:
  button-pill-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "40px"
  button-pill-primary-hover:
    backgroundColor: "oklch(0.19 0 0 / 0.9)"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
  button-square-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "36px"
  button-square-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  composer:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: "8px"
  tool-card:
    backgroundColor: "oklch(0.94 0 0 / 0.2)"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  status-chip-live:
    backgroundColor: "oklch(0.696 0.17 162.48 / 0.1)"
    textColor: "{colors.status-live}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  overline:
    textColor: "oklch(0.6 0 0 / 0.7)"
    typography: "{typography.overline}"
  sidebar-row:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "6px 8px"
---

# Design System: becode

## Overview

**Creative North Star: "The Glass Workshop"**

becode is a wall of glass around someone else's running product. The person it is built for is not
here to read a transcript — they are here to watch a change land in an app they know, and say yes or
no to it. So the interface behaves like the frame of a workshop window: it holds the view steady, it
labels what is happening on the other side of the glass, and it never asks to be looked at instead.
Every surface becode draws is chrome. The content is always something else — the target app, the
agent's activity, the diff about to leave the machine.

The material language follows from that. Warm-grey ground, white surfaces, hairline borders at
fractional opacity, and a working type range that tops out well below anything the target app will
use. Colour is almost entirely absent, and when it appears it is never decoration — it is a fact
about state: this is running, this failed, this needs you. The only motion is press physics and
layout glides, all of it wired through `useReducedMotion`, because motion here is feedback on an
action, never atmosphere.

Two anti-references are confirmed and binding. becode must not look like an **enterprise dashboard**
— no KPI tile grids, no chart widgets, no sidebar-plus-topbar-plus-breadcrumb scaffolding around a
product that has exactly one job. And it must not look like a **developer IDE or terminal** — no
monospace chrome, no syntax-coloured furniture, no file trees. The second is not taste. The person
using becode cannot read code, and dressing the tool as a code tool is a lie about who it is for.

**Key Characteristics:**

- Neutral-grey ground; chromatic colour reserved entirely for state
- Hairline borders at fractional opacity as the primary separator
- A working type range of 11–16px, with display type appearing exactly once
- Radius that decreases inward: 16px container → 14px panel → 10px row → 8px control
- Pill for the one action the person came to take; square for everything else
- Reduced-motion honoured on every animated component, without exception

*Three decisions in this document were made during documentation rather than read off the code:
the shadow vocabulary (§Elevation), the full type hierarchy above 14px (§Typography), and the
status tokens plus the accent hue move (§Colors). They are marked where they appear. Everything
else describes the system as implemented.*

## Colors

A fully neutral greyscale with a single low-chroma accent and a four-hue status set. There is no
brand colour, and that is the system, not a gap — a hue that meant "becode" would compete with the
product on the other side of the glass.

### Primary

- **Ink** (`oklch(0.19 0 0)`): The near-black of primary buttons, the approval card's confirm
  action, and any surface that must read as the system's own voice rather than the target app's.
  Inverted in dark mode to a near-white; the role is contrast, not the colour.

### Neutral

- **Workbench** (`oklch(0.971 0 0)`): The page ground. Deliberately off-white — white surfaces have
  to sit on something, and pure white on pure white gives the border all the work to do.
- **Surface** (`oklch(1 0 0)`): Pure white. Cards, popovers, the composer, anything the person acts
  on directly. The one-step lift from Workbench is how elevation reads before shadow is involved.
- **Graphite** (`oklch(0.16 0 0)`): Body text and every heading.
- **Slate** (`oklch(0.6 0 0)`): Secondary text, metadata, inactive icons. Frequently taken down
  further to `/70` or `/60` for overlines and timestamps.
- **Hairline** (`oklch(0.916 0 0)`): Every border in the product. Almost never used at full
  strength — see the Hairline Rule.
- **Muted** (`oklch(0.94 0 0)`): Hover fills and inset panels, usually at `/20` to `/60`.

### Tertiary

- **Signal Teal** (`oklch(0.58 0.1 210)`): The accent, and it has exactly one job: marking a skill
  mention in the composer and its highlight overlay. *Changed during documentation.* It was
  `oklch(0.6 0.15 62)` — 3.7° of hue from `amber-600`, which is the warning status. Two things that
  mean completely different things were the same colour. Teal at 210° sits roughly equidistant from
  the live (162°) and info (255°) hues, and carries the lowest chroma of anything on screen.

### Status

*Tokenized during documentation.* The quartet below already appeared as a consistent three-part
recipe across six files; it was raw Tailwind. The values are unchanged.

- **Fail** (`oklch(0.586 0.253 17.585)`): A tool errored, a server died, a gate refused.
- **Live** (`oklch(0.596 0.145 163.225)`): Something is running and answering on its port. The one
  status that also appears as a bare 6px dot, in the sidebar and the status bar.
- **Info** (`oklch(0.546 0.245 262.881)`): A tool is in flight, or a note the person should see.
- **Warn** (`oklch(0.666 0.179 58.318)`): Waiting on a person — an approval, a question, a port
  that needs freeing.

### Named Rules

**The Signal Rule.** Chromatic colour appears only when something is true about the system's state.
There is no decorative colour in becode, no brand accent on a heading, no coloured illustration. If
a hue cannot be traced to a running process, a failure, or a pending decision, it is a defect.

**The Status Triple Rule.** A status is always rendered as the same three-part recipe and never
improvised: text at the `-600` step (`-400` in dark), a `/10` fill of the `-500` step, and a `/30`
border of the `-500` step. Four hues, one recipe, no fifth hue.

**The Hairline Rule.** Borders are drawn at fractional opacity — `border-border/60` is the default,
`/80` for a surface the person is about to act on, `/50` for an inset panel. A border at full
strength reads as a table cell, which is the enterprise-dashboard direction.

## Typography

**Display / Body Font:** Geist (with Geist Fallback, ui-sans-serif, system-ui, sans-serif)
**Code Font:** Geist Mono (with Geist Mono Fallback, ui-monospace, monospace)

**Character:** One family doing everything, at low contrast and small size. Geist is neutral to the
point of being unmemorable, which is correct here — becode's type must not have an opinion the
target app has to argue with. Personality comes from the spacing and the restraint, not the letters.

### Hierarchy

*The roles above Body were established during documentation. The implementation carried only Body,
Label, an ad-hoc overline, and a single Display instance; the intermediate steps did not exist.*

- **Display** (500, 3rem/48px, 1.0, -0.03em): The `becode` wordmark on the empty state. This is its
  only appearance in the product.
- **Headline** (500, 1.25rem/20px, 1.3, -0.015em): The title of a full surface — the design system
  page's section headings. At most one per screen region.
- **Title** (500, 1rem/16px, 1.5): The one line on a surface a non-engineer must actually read: the
  approval question, an error's headline, the sentence explaining a refusal. This step exists so
  that the thing requiring a decision is never the same size as the metadata around it.
- **Body** (400, 0.875rem/14px, 1.5): The transcript, the composer, every control label. The
  composer runs at a 1.5rem/24px line-height specifically so the highlight mirror aligns with the
  textarea beneath it; do not change one without the other.
- **Label** (400, 0.75rem/12px, 1.33): Metadata, tool row subtitles, sidebar entries, chips. The
  most-used size in the product.
- **Overline** (500, 0.6875rem/11px, 0.12em, uppercase, Slate at `/60`–`/70`): Section markers above
  a group. It was invented independently three times at two different sizes; 11px at 0.12em is the
  reconciliation.
- **Code** (400, 0.75rem/12px, Geist Mono): File paths, skill tokens, log output, raw tool
  parameters.

### Named Rules

**The Machine Strings Rule.** Monospace marks text that came from or goes to a machine — a path, a
command, a log line, a `/skill` token. It is never used for chrome, labels, headings, or anything a
person is meant to read as prose. This is the whole distance between becode and an IDE.

**The Read-Once Rule.** Display and Headline appear at most once per surface. Anything that repeats
— rows, chips, tool calls, list entries — is Body or smaller. The ceiling exists because the target
app is on the other half of the screen and must always win the eye.

## Layout

A full-viewport shell (`h-dvh`, no page scroll) split into fixed-width chrome and one flexible
content region. The sidebar is a fixed 16rem/256px rail; the working area flexes. Transcript content
is centred in a 48rem/768px measure with 16px gutters widening to 24px at `sm`. Nothing about the
layout is content-width-driven — the shell is the frame and the panes fill it.

Spacing runs on a 4px base, and only six steps are in real use: 4, 6, 8, 12, 16, 24. Density is
high by intent: a 6px vertical pad on a sidebar row, 8px inside the composer, 12px inside an inset
panel, 16px inside a card, 24px at the surface edge. Gaps cluster at 4/6/8/12px for anything
inline; the one large gap in the product is the 40px between transcript turns, which is what stops
a wall of tool rows from reading as a log file.

becode is desktop-only in practice — one person, one machine, one browser window beside the app
they are changing. Tailwind's default breakpoints are inherited and only `sm` is used, for gutter
width. There is no mobile layout and none is planned.

### Named Rules

**The Chrome Yields Rule.** becode's own surfaces never claim more of the viewport than the thing
being observed. When a running app, a log tail, or a design system is on screen, it takes the
larger share and the chat takes the smaller.

## Elevation & Depth

*This section is a decision, not an extraction.* The implementation has **no shadows at all** —
`app/_components/` contains zero `box-shadow` declarations, and the only shadow utilities in the
tree are shadcn defaults on primitives the app does not use directly. Depth is currently carried
entirely by the one-step lift from Workbench to Surface plus a hairline border, which works but
gives becode no way to distinguish the thing being watched from the frame around it — the exact
distinction the Glass Workshop depends on.

The vocabulary below is deliberately two entries. Shadow is a scarce marker here, not a texture.

### Shadow Vocabulary

- **Observe** (`box-shadow: 0 1px 2px oklch(0 0 0 / 0.04), 0 8px 24px -8px oklch(0 0 0 / 0.10)`):
  The observation surface — the pane holding the running target app, and only that. It is the one
  element in becode that is not chrome, and the lift is how the eye knows.
- **Overlay** (`box-shadow: 0 8px 32px -8px oklch(0 0 0 / 0.18)`): Things that genuinely float free
  of the layout — dialogs, popovers, the command palette. Never applied to an inline card.

In dark mode both shadows are near-invisible against `oklch(0.145 0 0)` and are not compensated for
with heavier values. Depth there is carried by the Surface step (`oklch(0.205)` on `oklch(0.145)`)
and the border, which is what the light theme falls back to anyway.

### Named Rules

**The Workshop Window Rule.** Shadow marks the observation surface. If an element is not the running
product and not a true overlay, it is flat — hairline border and a tonal step, nothing else. Adding
a shadow to a card, a row, a chip, or a button is a defect.

## Shapes

Rounded throughout, on a scale derived from a single `--radius: 0.625rem` token: 6px (sm), 8px (md),
10px (lg), 14px (xl). Two values sit outside the derivation — 16px (`rounded-2xl`, Tailwind's own
fixed step, which the theme block does not override) and the full pill.

Form language is soft-rectangular with one hard exception: anything expressing a *state* rather than
an *action* is fully round. Status chips, the live dot, the attachment remove control, the paperclip
and send buttons. Roundness signals "this is a condition"; a radius signals "this is a thing".

Borders are 1px, always, everywhere. There are no dividers wider than a hairline and no rules drawn
in a colour other than `--border`.

### Named Rules

**The Nesting Rule.** Radius decreases inward. A 16px container holds 14px panels, which hold 10px
rows, which hold 8px controls. An inner element with a larger radius than its parent is a defect.

## Components

### Buttons

Two systems coexist, and the split is by role rather than by preference.

- **Pill** (`components/motion/button`) — **Shape:** fully round (`9999px`). **Primary:** Ink on
  Surface text, 40px tall, 20px horizontal. **Motion:** spring press to 0.93 scale and hover lift to
  1.02 (stiffness 500, damping 30, mass 0.6), both suppressed under reduced motion. **Use:** the one
  action the person came to this surface to take — *Ship this change*, *Start*, the approval confirm.
- **Square** (`components/ui/button`) — **Shape:** 8px radius. **Default:** Ink fill, 36px tall.
  **Ghost / Outline:** transparent or hairline-bordered, 32px at `sm`. **Focus:** 3px ring at
  `--ring/50`. **Use:** everything else — toolbar controls, dialog footers, settings forms, icon
  actions. No motion.

### Named Rules

**The One Pill Rule.** At most one pill per surface. A second pill means two things are claiming to
be the primary action, which means neither is.

### Cards / Containers

- **Corner Style:** 16px for the outermost card (composer, tool row), 14px for an inset panel.
- **Background:** Surface for anything acted on; `Muted/20` for a tool row; `Surface/70` for a
  parameter grid inside one.
- **Shadow Strategy:** none — see the Workshop Window Rule.
- **Border:** hairline at `/60`, or `/50` when nested inside another bordered surface.
- **Internal Padding:** 16px at the card edge, 12px inside an inset panel.

### Inputs / Fields

- **Style:** hairline border, transparent fill, 8px radius, 36px tall.
- **Focus:** 3px ring at `--ring/50` plus a border shift to `--ring`.
- **Error:** border and ring swap to `destructive`. Note that `InputGroup`'s built-in
  `has-[…aria-invalid…]` style does not compile in this project and the error ring must be driven
  from state; and that `border-*` utilities lose to the unlayered `* { border-color: var(--border) }`
  in `globals.css`, so error state is carried by the ring, never the border.

### Composer (signature)

The product's centre of gravity. A 16px-radius Surface card with a `/80` hairline that shifts to
`--foreground/25` on focus-within, 8px of padding, and three stacked regions: attachment chips and
skill suggestions above, the textarea, then a 32px action row. The textarea itself is transparent
with a mirror `<div>` beneath it rendering the same text with `/skill` tokens in Signal Teal — which
is why its typography (14px / 24px line-height) is load-bearing and shared between the two layers.
Drag-over swaps the border to `--foreground/40` and the fill to `Muted/40`.

### Tool Row (signature)

How every agent action is reported. A 16px-radius `Muted/20` card with a `/60` hairline, containing
a 32px square icon well (14px radius, Surface fill, hairline border) beside a Body-weight title and
a Code-styled subtitle. A status chip sits at the right on the Status Triple recipe. Parameters, when
shown, appear in a 14px-radius `Surface/70` grid with a `minmax(0,7rem) minmax(0,1fr)` two-column
layout — label in Slate, value in Code at `foreground/85`.

### Status Chip

Fully round, `2px 8px`, 11px medium. Renders the Status Triple. This is the only element in becode
allowed to carry a chromatic fill.

### Overline

11px, 500, uppercase, `0.12em` tracking, Slate at `/60`–`/70`. Marks a group of related rows. Never
followed by a rule or border — the tracking and the colour are the separation.

### Sidebar Row

10px radius, 6px/8px padding, transparent at rest, `Muted/60` on hover, `Muted` when active. Trailing
actions (rename, delete, settings) are hidden and revealed on `group-hover` or `focus-visible`,
which keeps a two-level tree from reading as a toolbar. A live chat is marked with a 6px round Live
dot in place of its icon — never with a colour on the label.

## Do's and Don'ts

### Do:

- **Do** draw every separator as a 1px `--border` hairline at fractional opacity; `/60` is the
  default, `/80` for an actionable surface, `/50` when nested.
- **Do** reserve chromatic colour for state, and render it as the Status Triple: `-600` text
  (`-400` dark), `-500/10` fill, `-500/30` border.
- **Do** decrease radius inward — 16px container, 14px panel, 10px row, 8px control.
- **Do** wire every animated component through `useReducedMotion`, and use the tokens in
  `lib/ease.ts` rather than inline curves: `SPRING_PRESS` for taps, `SPRING_LAYOUT` for glides,
  `SPRING_PANEL` for overlays, `EASE_OUT` for anything else.
- **Do** put the sentence a person must read at Title (16px) and everything around it at Label
  (12px) or Body (14px).
- **Do** let the observed thing — the running app, a log tail, a design system — take the larger
  share of the viewport.

### Don't:

- **Don't** add a shadow to anything that is not the observation pane or a true overlay.
- **Don't** use monospace for chrome. It marks machine strings only: paths, commands, log lines,
  skill tokens.
- **Don't** put a file path, a diff, a stack trace, or a framework name in the primary content of a
  surface where a decision is made. The person this is built for cannot act on it, and a surface
  that requires it has failed regardless of correctness.
- **Don't** build KPI tile grids, chart widgets, or breadcrumb-plus-topbar scaffolding. becode has
  one job.
- **Don't** introduce a fifth status hue, or a chromatic colour with no state behind it.
- **Don't** use Display type anywhere but the empty-state wordmark, or put two pills on one surface.
- **Don't** rely on a `border-*` utility for error state — the unlayered `* { border-color }` rule in
  `globals.css` outranks it. Carry error on the ring.
