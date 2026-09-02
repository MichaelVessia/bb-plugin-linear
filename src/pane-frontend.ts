/** The deliberately small reaction palette shared by every pane surface. */
export const PANE_REACTION_EMOJIS = [
  "👍",
  "👎",
  "😄",
  "🎉",
  "😕",
  "❤️",
  "🚀",
  "👀",
] as const;

const PANE_REACTION_NAME_BY_EMOJI: Record<(typeof PANE_REACTION_EMOJIS)[number], string> = {
  "👍": "+1",
  "👎": "-1",
  "😄": "smile",
  "🎉": "tada",
  "😕": "confused",
  "❤️": "heart",
  "🚀": "rocket",
  "👀": "eyes",
};

const PANE_REACTION_EMOJI_BY_NAME = new Map(
  Object.entries(PANE_REACTION_NAME_BY_EMOJI).map(([emoji, name]) => [name, emoji]),
);

/** Converts a picker glyph to the normalized name expected by Linear's API. */
export function reactionNameForPickerEmoji(emoji: string): string {
  return PANE_REACTION_NAME_BY_EMOJI[
    emoji as (typeof PANE_REACTION_EMOJIS)[number]
  ] ?? emoji;
}

export interface MentionRange {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

/**
 * Finds the active `@query` immediately before the caret.
 *
 * Linear names may contain spaces, so the range is bounded by the current
 * line rather than by the last word. Existing `@[name](id)` markup is not an
 * active query: `[` terminates the candidate range.
 */
export function mentionRangeAtCaret(value: string, caret: number): MentionRange | null {
  const safeCaret = Math.max(0, Math.min(caret, value.length));
  const lineStart = value.lastIndexOf("\n", safeCaret - 1) + 1;
  const beforeCaret = value.slice(lineStart, safeCaret);
  const at = beforeCaret.lastIndexOf("@");
  if (at < 0) return null;

  const absoluteStart = lineStart + at;
  const preceding = absoluteStart === 0 ? "" : value[absoluteStart - 1] ?? "";
  if (preceding !== "" && !/\s/u.test(preceding)) return null;

  const query = value.slice(absoluteStart + 1, safeCaret);
  if (query.length > 60 || /[@\[\]()]/u.test(query)) return null;
  return { start: absoluteStart, end: safeCaret, query };
}

/** Keeps Escape sticky for the same mention range while allowing a changed query to reopen it. */
export function mentionRangeAtCaretUnlessDismissed(
  value: string,
  caret: number,
  dismissed: Pick<MentionRange, "start" | "query"> | null,
): MentionRange | null {
  const range = mentionRangeAtCaret(value, caret);
  if (
    range !== null &&
    dismissed !== null &&
    range.start === dismissed.start &&
    range.query === dismissed.query
  ) {
    return null;
  }
  return range;
}

export interface MentionInsertion {
  readonly value: string;
  readonly caret: number;
}

/** Inserts Linear's documented mention markup and leaves the caret after it. */
export function insertMention(
  value: string,
  range: Pick<MentionRange, "start" | "end">,
  candidate: { readonly id: string; readonly displayName: string },
): MentionInsertion {
  const markup = `@[${candidate.displayName}](${candidate.id})`;
  const suffix = value.slice(range.end);
  const spacer = suffix === "" || !/^\s/u.test(suffix) ? " " : "";
  const nextValue = `${value.slice(0, range.start)}${markup}${spacer}${suffix}`;
  return {
    value: nextValue,
    caret: range.start + markup.length + spacer.length,
  };
}

/** Linear custom emoji arrive as names; make that fallback visibly literal. */
export function displayReactionEmoji(emoji: string): string {
  const standardEmoji = PANE_REACTION_EMOJI_BY_NAME.get(emoji);
  if (standardEmoji !== undefined) return standardEmoji;
  if (emoji.startsWith(":") && emoji.endsWith(":")) return emoji;
  if (/\p{Extended_Pictographic}/u.test(emoji)) return emoji;
  return `:${emoji}:`;
}
