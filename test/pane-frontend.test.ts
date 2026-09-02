import { describe, expect, it } from "vitest";
import * as paneFrontend from "../src/pane-frontend.js";

const {
  displayReactionEmoji,
  insertMention,
  mentionRangeAtCaret,
  PANE_REACTION_EMOJIS,
} = paneFrontend;

describe("pane reaction helpers", () => {
  it("keeps the fixed picker set stable", () => {
    expect(PANE_REACTION_EMOJIS).toEqual([
      "👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀",
    ]);
  });

  it("renders workspace emoji names as colon-delimited text", () => {
    expect(displayReactionEmoji("ship_it")).toBe(":ship_it:");
    expect(displayReactionEmoji(":already_named:")).toBe(":already_named:");
    expect(displayReactionEmoji("👍")).toBe("👍");
  });

  it("translates Linear's eight standard reaction names at the UI boundary", () => {
    const reactionNameForPickerEmoji = (
      paneFrontend as typeof paneFrontend & {
        reactionNameForPickerEmoji?: (emoji: string) => string;
      }
    ).reactionNameForPickerEmoji;
    const standardReactions = [
      ["👍", "+1"],
      ["👎", "-1"],
      ["😄", "smile"],
      ["🎉", "tada"],
      ["😕", "confused"],
      ["❤️", "heart"],
      ["🚀", "rocket"],
      ["👀", "eyes"],
    ] as const;

    for (const [glyph, name] of standardReactions) {
      expect(reactionNameForPickerEmoji?.(glyph)).toBe(name);
      expect(displayReactionEmoji(name)).toBe(glyph);
    }
  });
});

describe("pane mention helpers", () => {
  it("finds a multi-word query at the caret without reopening stored markup", () => {
    expect(mentionRangeAtCaret("Ask @Jane D", 11)).toEqual({
      start: 4,
      end: 11,
      query: "Jane D",
    });
    expect(mentionRangeAtCaret("Ask @[Jane](u1)", 15)).toBeNull();
    expect(mentionRangeAtCaret("email@example", 13)).toBeNull();
  });

  it("inserts exact Linear markup and reports the next caret", () => {
    const insertion = insertMention(
      "Ask @Ja about this",
      { start: 4, end: 7 },
      { id: "user-1", displayName: "Jane Doe" },
    );
    expect(insertion.value).toBe("Ask @[Jane Doe](user-1) about this");
    expect(insertion.value.slice(4, insertion.caret)).toBe("@[Jane Doe](user-1)");
  });

  it("keeps an escaped mention query dismissed until its query changes", () => {
    const mentionRangeAtCaretUnlessDismissed = (
      paneFrontend as typeof paneFrontend & {
        mentionRangeAtCaretUnlessDismissed?: (
          value: string,
          caret: number,
          dismissed: { start: number; query: string } | null,
        ) => { start: number; end: number; query: string } | null;
      }
    ).mentionRangeAtCaretUnlessDismissed;
    const dismissed = { start: 4, query: "Jane D" };

    expect(mentionRangeAtCaretUnlessDismissed?.("Ask @Jane D", 11, dismissed)).toBeNull();
    expect(mentionRangeAtCaretUnlessDismissed?.("Ask @Jane D", 10, dismissed)).toEqual({
      start: 4,
      end: 10,
      query: "Jane ",
    });
  });
});
