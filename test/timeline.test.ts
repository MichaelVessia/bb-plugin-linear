import { describe, expect, it } from "vitest";
import { buildTimeline, describeEvent, nestComments, type TimelineVocabulary } from "../src/select/timeline.js";
import type { CommentView } from "../src/contract.js";
import type { HistoryEventRow } from "../src/store/rows.js";
import { member, NOW } from "./helpers/store.js";

const vocab: TimelineVocabulary = {
  states: new Map([["s1", "Todo"], ["s2", "In Progress"]]),
  members: new Map([["u1", "Jane"]]),
  priorities: new Map([[2, "High"]]),
  projects: new Map([["p1", "Alpha"], ["p2", "Beta"]]),
  cycles: new Map([["c1", "Cycle 7"]]),
  issues: new Map([["i2", "ENG-12"]]),
  labels: new Map([["l1", "Bug"]]),
  teams: new Map([["t2", "Platform"]]),
  milestones: new Map([["m1", "Launch"]]),
  estimationType: "linear",
};

const event = (kind: HistoryEventRow["kind"], payload: Record<string, unknown>): HistoryEventRow => ({
  id: `h:${kind}`,
  issueId: "i1",
  createdAt: NOW + 10,
  actorId: "u1",
  botName: null,
  kind,
  payload,
});

describe("describeEvent", () => {
  it.each([
    ["state", { from: "s1", to: "s2" }, "changed status from Todo to In Progress"],
    ["assignee", { from: null, to: "u1" }, "assigned to Jane"],
    ["priority", { from: null, to: 2 }, "set priority to High"],
    ["estimate", { from: null, to: 3 }, "set estimate to 3 points"],
    ["dueDate", { from: null, to: "2026-09-03" }, "set due date to"],
    ["project", { from: "p1", to: "p2" }, "moved from project Alpha to Beta"],
    ["cycle", { from: null, to: "c1" }, "added to cycle Cycle 7"],
    ["parent", { from: null, to: "i2" }, "set parent to ENG-12"],
    ["title", { from: "Old", to: "New" }, "changed title from Old to New"],
    ["description", {}, "edited the description"],
    ["labels", { added: ["l1"], removed: [] }, "added label Bug"],
    ["attachment", { attachmentId: "a1" }, "linked an attachment"],
    ["relations", { changes: [{ identifier: "ENG-12", type: "blocks" }] }, "marked as blocking ENG-12"],
    ["relations", { changes: [{ identifier: "ENG-12", type: "add_blocks" }] }, "marked as blocking ENG-12"],
    ["relations", { changes: [{ identifier: "ENG-12", type: "added_blocked_by" }] }, "marked as blocked by ENG-12"],
    ["relations", { changes: [{ identifier: "ENG-12", type: "blocked_by" }] }, "marked as blocked by ENG-12"],
    ["archived", { archived: true }, "archived"],
    ["trashed", { trashed: true }, "trashed"],
    ["team", { from: null, to: "t2" }, "moved to team Platform"],
    ["milestone", { from: null, to: "m1" }, "added to milestone Launch"],
  ] as const)("phrases %s with workspace vocabulary", (kind, payload, expected) => {
    expect(describeEvent(event(kind, payload), vocab)).toContain(expected);
  });

  it("degrades unknown ids and relation types without leaking opaque ids", () => {
    expect(describeEvent(event("state", { from: "unknown", to: "other" }), vocab)).toBe(
      "changed status from a state to a state",
    );
    expect(
      describeEvent(
        event("relations", { changes: [{ identifier: "ENG-99", type: "new-kind" }] }),
        vocab,
      ),
    ).toBe("changed a relation with ENG-99");
  });
});

function comment(id: string, parentId: string | null, createdAt: number): Omit<CommentView, "replies"> {
  return {
    id,
    parentId,
    createdAt,
    body: id,
    author: "Jane",
    authorInitials: "J",
    avatarUrl: null,
    createdAtRelative: "now",
    createdAtAbsolute: "today",
    edited: false,
    url: null,
    resolved: false,
    resolvedBy: null,
    reactions: [],
  };
}

describe("timeline projection", () => {
  it("keeps replies attached, interleaves roots with events, and forces created first", () => {
    const comments = nestComments([
      comment("reply", "root", NOW + 30),
      comment("root", null, NOW + 20),
      comment("orphan", "missing", NOW + 40),
    ]);
    expect(comments.map((entry) => entry.id)).toEqual(["root", "orphan"]);
    expect(comments[0]?.replies.map((entry) => entry.id)).toEqual(["reply"]);

    const timeline = buildTimeline({
      issueId: "i1",
      createdAt: NOW,
      creatorId: "u1",
      comments,
      events: [event("description", {})],
      members: new Map([["u1", member("u1", "Jane Doe")]]),
      vocab,
      now: NOW + 60,
    });
    expect(timeline[0]).toMatchObject({ id: "i1:created", text: "created the issue" });
    expect(timeline.slice(1)).toEqual([
      expect.objectContaining({ id: "h:description" }),
      { kind: "comment", commentId: "root" },
      { kind: "comment", commentId: "orphan" },
    ]);
    expect(timeline).not.toContainEqual({ kind: "comment", commentId: "reply" });
  });

  it("uses the bot name, then Linear, when there is no human actor", () => {
    const bot = { ...event("description", {}), actorId: null, botName: "Workflow" };
    const plain = { ...event("attachment", {}), id: "plain", actorId: null, botName: null };
    const timeline = buildTimeline({
      issueId: "i1",
      createdAt: NOW,
      creatorId: null,
      comments: [],
      events: [bot, plain],
      members: new Map(),
      vocab,
      now: NOW + 60,
    });
    expect(timeline[1]).toMatchObject({ bot: "Workflow", actor: null });
    expect(timeline[2]).toMatchObject({ bot: "Linear", actor: null });
  });

  it("renders missing non-null human ids as Someone instead of Linear", () => {
    const timeline = buildTimeline({
      issueId: "i1",
      createdAt: NOW,
      creatorId: "missing-creator",
      comments: [],
      events: [{ ...event("description", {}), actorId: "missing-actor" }],
      members: new Map(),
      vocab,
      now: NOW + 60,
    });
    expect(timeline[0]).toMatchObject({ actor: { name: "Someone", initials: "?" }, bot: null });
    expect(timeline[1]).toMatchObject({ actor: { name: "Someone", initials: "?" }, bot: null });
  });
});
