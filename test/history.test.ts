import { describe, expect, it } from "vitest";
import type { IssueHistoryNode } from "../src/linear/types.js";
import { normalizeHistory } from "../src/sync/history.js";

function history(overrides: Partial<IssueHistoryNode> = {}): IssueHistoryNode {
  return {
    id: "h1",
    createdAt: "2026-09-02T08:00:00.000Z",
    actorId: null,
    actor: null,
    botActor: null,
    fromStateId: null,
    toStateId: null,
    fromAssigneeId: null,
    toAssigneeId: null,
    fromPriority: null,
    toPriority: null,
    fromEstimate: null,
    toEstimate: null,
    fromDueDate: null,
    toDueDate: null,
    fromProjectId: null,
    toProjectId: null,
    fromCycleId: null,
    toCycleId: null,
    fromParentId: null,
    toParentId: null,
    fromTitle: null,
    toTitle: null,
    addedLabelIds: null,
    removedLabelIds: null,
    updatedDescription: null,
    archived: null,
    trashed: null,
    autoArchived: null,
    autoClosed: null,
    attachmentId: null,
    fromTeamId: null,
    toTeamId: null,
    fromProjectMilestone: null,
    toProjectMilestone: null,
    relationChanges: null,
    ...overrides,
  };
}

describe("normalizeHistory", () => {
  it("splits a multi-change history node into stable typed events", () => {
    expect(
      normalizeHistory(
        history({
          fromStateId: "todo",
          toStateId: "doing",
          fromAssigneeId: null,
          toAssigneeId: "u1",
          updatedDescription: true,
          fromProjectMilestone: { id: "m1" },
          toProjectMilestone: { id: "m2" },
        }),
      ),
    ).toEqual([
      { kind: "state", payload: { from: "todo", to: "doing" } },
      { kind: "assignee", payload: { from: null, to: "u1" } },
      { kind: "description", payload: {} },
      { kind: "milestone", payload: { from: "m1", to: "m2" } },
    ]);
  });

  it("preserves label additions and removals in one event", () => {
    expect(
      normalizeHistory(history({ addedLabelIds: ["bug", "ui"], removedLabelIds: ["old"] })),
    ).toEqual([
      {
        kind: "labels",
        payload: { added: ["bug", "ui"], removed: ["old"] },
      },
    ]);
  });

  it("preserves relation identifiers and Linear relation change types", () => {
    expect(
      normalizeHistory(
        history({
          relationChanges: [
            { identifier: "ENG-12", type: "blocks" },
            { identifier: "ENG-13", type: "removed_related" },
          ],
        }),
      ),
    ).toEqual([
      {
        kind: "relations",
        payload: {
          changes: [
            { identifier: "ENG-12", type: "blocks" },
            { identifier: "ENG-13", type: "removed_related" },
          ],
        },
      },
    ]);
  });

  it("returns null when the node carries nothing renderable", () => {
    expect(normalizeHistory(history())).toBeNull();
  });

  it("ignores false automatic archive flags but reads a false trashed flag as a restore", () => {
    expect(normalizeHistory(history({ autoArchived: false, autoClosed: false }))).toBeNull();
    expect(normalizeHistory(history({ trashed: false }))).toEqual([
      { kind: "trashed", payload: { trashed: false } },
    ]);
    expect(normalizeHistory(history({ autoArchived: true }))).toEqual([
      {
        kind: "archived",
        payload: { archived: null, autoArchived: true, autoClosed: null },
      },
    ]);
  });
});
