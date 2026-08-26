/**
 * Whether a target repo carries impeccable's design context, and whether a task can see it.
 *
 * Impeccable keeps two files at a project root — PRODUCT.md (product truth, from an interview) and
 * DESIGN.md (visual tokens and prose, generated from the repo's own code) — plus a token sidecar at
 * `.impeccable/design.json`. They are the design system this agent is supposed to work from.
 *
 * The third state is the reason this file exists. `git worktree add` copies **tracked** files only,
 * so a repo where someone ran the installer but never committed looks exactly like a repo that
 * never had impeccable at all — from inside the worktree, which is all a task ever sees. Checking
 * the source checkout too is what turns that silent nothing into "commit it".
 */
import fs from "node:fs";
import path from "node:path";

/** `ready` — the worktree has it. `uncommitted` — only the checkout does. `missing` — neither. */
export type ImpeccableState = "ready" | "uncommitted" | "missing";

export type ImpeccableContext = {
  state: ImpeccableState;
  /** Repo-relative paths that exist in the worktree, for the agent to read. */
  files: string[];
};

/**
 * Where impeccable looks, in its own order — project root first, then two fallback context dirs
 * (`context.mjs:44-45,129-169`). Product and design resolve independently: a repo may carry one and
 * not the other, and impeccable inherits them separately.
 */
const CANDIDATES = [
  ["PRODUCT.md", ".agents/context/PRODUCT.md", "docs/PRODUCT.md"],
  ["DESIGN.md", ".agents/context/DESIGN.md", "docs/DESIGN.md"],
  [".impeccable/design.json"],
];

/** The first candidate in each group that exists under `root`. */
const found = (root: string): string[] =>
  CANDIDATES.map((group) => group.find((rel) => fs.existsSync(path.join(root, rel)))).filter(
    (rel): rel is string => rel !== undefined,
  );

export function impeccableContext(worktree: string, checkout: string): ImpeccableContext {
  const files = found(worktree);
  if (files.length > 0) return { state: "ready", files };
  // Nothing in the worktree is only half the answer: the checkout says which of the two fixes below
  // the person actually needs.
  return { state: found(checkout).length > 0 ? "uncommitted" : "missing", files: [] };
}

/**
 * A project's design context, for the sidebar — a different question from a task's.
 *
 * `impeccableContext` asks "can this worktree see the design system", which is what an agent about
 * to edit needs. A project row asks something the person needs before they start: is this repo set
 * up at all, and what is the design system becode would be working from. So this reads the
 * checkout, reports the installer separately from the context files, and names the files git does
 * not track — those are the ones that will vanish the moment a task is cut.
 */
export type ProjectDesign = {
  /** `.impeccable/config.json` — someone ran the installer here. */
  installed: boolean;
  /** Context files present in the checkout, repo-relative. */
  files: string[];
  /** Of those, the ones git does not track. A worktree is built from tracked files only. */
  untracked: string[];
  /** DESIGN.md's frontmatter. The design system itself, not a path to it. */
  system: DesignSystem | null;
};

export type Token = { name: string; value: string };

export type TypeRole = {
  name: string;
  family?: string;
  size?: string;
  weight?: string;
  lineHeight?: string;
  letterSpacing?: string;
};

/** One entry under `components:`, with every `{token.ref}` already resolved to a real value. */
export type DesignComponent = {
  name: string;
  backgroundColor?: string;
  textColor?: string;
  rounded?: string;
  padding?: string;
  height?: string;
  width?: string;
  size?: string;
  /** The type role this component is set in, resolved from `{typography.<role>}`. */
  type?: TypeRole;
};

export type DesignSystem = {
  name?: string;
  description?: string;
  colors: Token[];
  spacing: Token[];
  rounded: Token[];
  type: TypeRole[];
  components: DesignComponent[];
};

const CONFIG = ".impeccable/config.json";

/** Where DESIGN.md may sit, in impeccable's own order. */
const DESIGN = CANDIDATES[1];

export async function projectDesign(
  repo: string,
  tracked: (paths: string[]) => Promise<string[]>,
): Promise<ProjectDesign> {
  const files = found(repo);
  const installed = fs.existsSync(path.join(repo, CONFIG));
  if (!installed && files.length === 0) {
    return { installed: false, files: [], untracked: [], system: null };
  }

  const known = await tracked([...files, CONFIG]).catch((): string[] => []);
  const design = DESIGN.find((rel) => fs.existsSync(path.join(repo, rel)));

  return {
    installed,
    files,
    untracked: [...files, ...(installed ? [CONFIG] : [])].filter((rel) => !known.includes(rel)),
    system: design ? readDesignSystem(path.join(repo, design)) : null,
  };
}

/**
 * DESIGN.md's YAML frontmatter, as much of it as this UI draws.
 *
 * ponytail: an indentation reader over four known keys, not a YAML dependency. The schema is
 * impeccable's own and shallow — `colors`, `rounded` and `spacing` are one level of `key: value`,
 * `typography` is two. Components and `{token.refs}` are not drawn, so they are not read. If this
 * ever needs the whole document, take the dependency rather than growing this.
 */
export function readDesignSystem(file: string): DesignSystem | null {
  const text = fs.readFileSync(file, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!frontmatter) return null;
  return parseFrontmatter(frontmatter[1]);
}

const unquote = (value: string) => value.trim().replace(/^["']|["']$/g, "");

/** `colors`, `rounded` and `spacing` are one level of `key: value`. */
const FLAT = ["colors", "rounded", "spacing"] as const;
/** `typography` and `components` nest one level further, into properties. */
const NESTED = ["typography", "components"] as const;

/**
 * A variant fills its gaps from the component it is a variant of.
 *
 * `button-primary-hover` declares only what changes — a background and a text colour — because the
 * schema treats variants as a naming convention rather than a structure. Drawn literally that is a
 * square, unpadded, zero-height slab beside the pill it is supposedly the hover state of, which
 * says something about the design system that is not true. The longest sibling whose name is a
 * dash-bounded prefix is the base; only undeclared properties are taken from it.
 */
function inherit(
  name: string,
  props: Record<string, string>,
  all: [string, Record<string, string>][],
): { props: Record<string, string> } {
  const base = all
    .filter(([other]) => other !== name && name.startsWith(`${other}-`))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return { props: base ? { ...base[1], ...props } : props };
}

export function parseFrontmatter(yaml: string): DesignSystem {
  const flat: Record<string, Token[]> = { colors: [], rounded: [], spacing: [] };
  const nested: Record<string, Map<string, Record<string, string>>> = {
    typography: new Map(),
    components: new Map(),
  };
  const system: DesignSystem = {
    colors: [],
    spacing: [],
    rounded: [],
    type: [],
    components: [],
  };
  let section = "";
  let entry = "";

  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const match = /^(\s*)([\w-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent, key, value] = match;

    if (indent.length === 0) {
      section = key;
      entry = "";
      if (key === "name") system.name = unquote(value);
      if (key === "description") system.description = unquote(value);
      continue;
    }
    // Two spaces is an entry under the section; four is a property of that entry. Deeper than
    // that the schema does not go, so nothing below is read.
    if (indent.length <= 2) {
      if (flat[section] && value) flat[section].push({ name: key, value: unquote(value) });
      if (nested[section]) {
        entry = key;
        nested[section].set(entry, {});
      }
      continue;
    }
    if (nested[section] && entry) nested[section].get(entry)![key] = unquote(value);
  }

  for (const key of FLAT) system[key] = flat[key];
  system.type = [...nested.typography].map(([name, props]) => ({
    name,
    family: props.fontFamily,
    size: props.fontSize,
    weight: props.fontWeight,
    lineHeight: props.lineHeight,
    letterSpacing: props.letterSpacing,
  }));

  // Components reference primitives; primitives never reference each other, so one pass resolves
  // everything. An unresolvable ref is dropped rather than drawn — a literal "{colors.primary}"
  // painted as a background is worse than the component simply not claiming a colour.
  const value = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    const ref = /^\{([\w-]+)\.([\w-]+)\}$/.exec(raw);
    if (!ref) return raw;
    const group = ref[1] === "colors" || ref[1] === "rounded" || ref[1] === "spacing" ? flat[ref[1]] : null;
    return group?.find((token) => token.name === ref[2])?.value;
  };

  const raw = [...nested.components];
  system.components = raw.map(([name, props]) => ({
    name,
    ...inherit(name, props, raw),
  })).map(({ name, props }) => ({
    name,
    backgroundColor: value(props.backgroundColor),
    textColor: value(props.textColor),
    rounded: value(props.rounded),
    padding: value(props.padding),
    height: value(props.height),
    width: value(props.width),
    size: value(props.size),
    type: system.type.find(
      (role) => role.name === /^\{typography\.([\w-]+)\}$/.exec(props.typography ?? "")?.[1],
    ),
  }));

  return system;
}

/**
 * The prose of a project's design context, ready to render.
 *
 * DESIGN.md's frontmatter is stripped: it is the same data `readDesignSystem` already returned as
 * specimens, and showing the YAML underneath them would be the design system twice — once drawn,
 * once as source.
 */
export function designDocs(repo: string): { path: string; text: string }[] {
  return found(repo)
    .filter((rel) => rel.endsWith(".md"))
    .map((rel) => ({
      path: rel,
      text: fs
        .readFileSync(path.join(repo, rel), "utf8")
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
        .trim(),
    }))
    .filter((doc) => doc.text.length > 0);
}
