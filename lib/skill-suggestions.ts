/**
 * What the person is describing, and the skill that already knows how to do it.
 *
 * The agent routes to skills off their `description` frontmatter, which works — but only once the
 * request is phrased in a way that trips the right one. The person asking has no way to know a
 * craft playbook for "this feels cramped" exists, so they never ask for it by name.
 *
 * These chips are the missing half: plain language in front, the real skill on hover, and a
 * sentence appended to the prompt that leaves the agent in no doubt. Nothing here is a boundary —
 * a chip adds a route, it never skips one. `design-system-first` still loads first either way.
 */
export type Suggestion = {
  id: string;
  /** What the person reads. No skill names, no jargon. */
  chip: string;
  /** What they learn on hover, once they want to. */
  skill: string;
  /** Appended to the prompt, where precision costs nothing. */
  append: string;
  /** Lowercase substrings. How they actually describe the problem, not what the skill calls it. */
  match: string[];
};

const SUGGESTIONS: Suggestion[] = [
  {
    id: "critique",
    chip: "Review this page's UX",
    skill: "impeccable · critique",
    append: "Do an impeccable critique pass on this before changing anything.",
    match: ["cramped", "confusing", "hard to read", "busy", "cluttered", "messy", "crowded"],
  },
  {
    id: "audit",
    chip: "Check accessibility and mobile",
    skill: "impeccable · audit",
    append: "Run an impeccable audit for accessibility and responsive behaviour.",
    match: ["mobile", "phone", "contrast", "accessible", "accessibility", "small screen", "tablet"],
  },
  {
    id: "bolder",
    chip: "Make it bolder",
    skill: "impeccable · bolder",
    append: "Use impeccable bolder — amplify it rather than nudging it.",
    match: ["bland", "boring", "safe", "flat", "generic", "plain", "forgettable"],
  },
  {
    id: "quieter",
    chip: "Tone it down",
    skill: "impeccable · quieter",
    append: "Use impeccable quieter — calm it down without stripping the character out.",
    match: ["loud", "shouty", "too much", "overwhelming", "aggressive", "distracting"],
  },
  {
    id: "polish",
    chip: "Final polish before shipping",
    skill: "impeccable · polish",
    append: "Do an impeccable polish pass — this is the last look before it ships.",
    match: ["polish", "finish", "tidy", "clean up", "before we ship", "last pass"],
  },
  {
    id: "animate",
    chip: "Add motion",
    skill: "impeccable · animate",
    append: "Use impeccable animate — purposeful motion, nothing decorative.",
    match: ["animate", "animation", "transition", "motion", "hover", "moves", "static"],
  },
  {
    id: "shape",
    chip: "Plan it before building",
    skill: "impeccable · shape",
    append: "Use impeccable shape to plan this before writing any code.",
    match: ["new page", "from scratch", "redesign", "rethink", "start over", "brand new"],
  },
  {
    id: "design-system",
    chip: "Match the existing design",
    skill: "design-system-first",
    append: "Follow the project's design system exactly — reuse what exists, invent nothing.",
    match: ["consistent", "match", "our style", "brand", "same as", "looks different", "off-brand"],
  },
];

/**
 * Below this a draft is one word and every keystroke would swap the chips underneath the person's
 * hands. Above it they have said enough to mean something.
 */
const MIN_DRAFT = 12;

/** Plain substring counting: a table this size does not earn a dependency or a debounce. */
export function suggest(draft: string): Suggestion[] {
  if (draft.trim().length < MIN_DRAFT) return [];

  const text = draft.toLowerCase();
  return SUGGESTIONS.map((suggestion) => ({
    suggestion,
    hits: suggestion.match.filter((word) => text.includes(word)).length,
  }))
    .filter((scored) => scored.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 3)
    .map((scored) => scored.suggestion);
}
