import { describe, expect, it } from "vitest";
import type { CommentView, TimelineEntry } from "../src/contract.js";
import { firstUnreadTimelineEntry } from "../src/select/timeline-unread.js";

const comment = (overrides: Partial<CommentView> = {}): CommentView => ({
  id: "comment-1",
  body: "hello",
  author: "Ada",
  authorInitials: "A",
  avatarUrl: null,
  createdAt: 10,
  createdAtRelative: "now",
  createdAtAbsolute: "today",
  edited: false,
  parentId: null,
  url: null,
  resolved: false,
  resolvedBy: null,
  reactions: [],
  replies: [],
  ...overrides,
});

const reply = (
  overrides: Partial<CommentView["replies"][number]> = {},
): CommentView["replies"][number] => ({
  id: "reply",
  body: "reply",
  author: "Grace",
  authorInitials: "G",
  avatarUrl: null,
  createdAt: 20,
  createdAtRelative: "now",
  createdAtAbsolute: "today",
  edited: false,
  parentId: "comment-1",
  url: null,
  resolved: false,
  resolvedBy: null,
  reactions: [],
  ...overrides,
});

describe("the timeline unread divider", () => {
  it("selects the first visible entry newer than the boundary", () => {
    const entries: TimelineEntry[] = [
      { kind: "event", id: "old", at: 9, atRelative: "earlier", atAbsolute: "9", actor: null, bot: "Linear", text: "old" },
      { kind: "comment", commentId: "comment-1" },
      { kind: "event", id: "later", at: 12, atRelative: "now", atAbsolute: "12", actor: null, bot: "Linear", text: "later" },
    ];
    expect(
      firstUnreadTimelineEntry(entries, new Map([["comment-1", comment()]]), 9),
    ).toBe("comment-1");
  });

  it("treats a new nested reply as new activity at its root thread", () => {
    const root = comment({
      createdAt: 2,
      replies: [reply()],
    });
    expect(
      firstUnreadTimelineEntry(
        [{ kind: "comment", commentId: root.id }],
        new Map([[root.id, root]]),
        10,
      ),
    ).toBe(root.id);
  });

  it("returns no divider without a boundary or a newer visible entry", () => {
    const entries: TimelineEntry[] = [{ kind: "comment", commentId: "comment-1" }];
    const comments = new Map([["comment-1", comment()]]);
    expect(firstUnreadTimelineEntry(entries, comments, null)).toBeNull();
    expect(firstUnreadTimelineEntry(entries, comments, 10)).toBeNull();
  });
});
