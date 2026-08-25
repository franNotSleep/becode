/**
 * `/impeccable` at the head of the composer, split out so it can be painted.
 *
 * The SDK exposes every skill as a slash command — `SlashCommand.name` is documented as "Skill name
 * (without the leading slash)". A plugin skill is namespaced, so becode's are `becode:impeccable`
 * with the bare `impeccable` as an alias; both resolve, and both are highlighted here.
 *
 * **Only the leading token counts.** Verified against a live session: with the prompt starting
 * `/impeccable …` the model quotes the skill body verbatim with `Read` disallowed, so the content
 * was injected; move the same token one word in and it answers "NONE". Painting a mid-sentence
 * `/impeccable` would therefore promise something that does not happen, which is why this is a
 * position rule and not a search-and-replace.
 *
 * A textarea cannot paint part of its own text, so `PromptInput` mirrors the result into an overlay
 * under a transparent-text textarea. That is the only reason this returns tokens rather than markup.
 */
export type Token = { text: string; skill: boolean };

const PLUGIN = "becode:";

/** The leading slash token, if the text opens with one. Leading blanks are allowed before it. */
const LEADING = /^(\s*)(\/[a-z0-9:-]+)/i;

const known = (raw: string, skills: string[]) => {
  const name = raw.slice(1).toLowerCase();
  return skills.includes(name.startsWith(PLUGIN) ? name.slice(PLUGIN.length) : name);
};

/** Consecutive runs of plain text and the skill mention, covering `text` exactly. */
export function tokenize(text: string, skills: string[]): Token[] {
  const match = text.match(LEADING);
  if (!match || !known(match[2], skills)) {
    return text.length > 0 ? [{ text, skill: false }] : [];
  }

  const [, blanks, token] = match;
  const rest = text.slice(blanks.length + token.length);
  return [
    ...(blanks ? [{ text: blanks, skill: false }] : []),
    { text: token, skill: true },
    ...(rest ? [{ text: rest, skill: false }] : []),
  ];
}

/**
 * The skill being typed, for the menu — `null` unless the draft opens with a slash token that has
 * not been finished with a space. An empty string means they have typed only `/`.
 *
 * `caret` is where the person is; the menu closes once they move past the token. Callers that do
 * not track a caret pass `text.length`, which is the same thing while they are still typing it.
 */
export function typingSkill(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = before.match(/^\s*\/([a-z0-9:-]*)$/i);
  return match ? match[1].toLowerCase() : null;
}
