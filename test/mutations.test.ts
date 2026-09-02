import { describe, expect, it, vi } from "vitest";
import {
  buildIssueUpdateInput,
  attachUrl,
  clientId,
  createIssue,
  deleteComment,
  editComment,
  postComment,
  react,
  relateIssues,
  setParent,
  unrelate,
  updateIssue,
  type MutationDeps,
} from "../src/mutations.js";
import { forbidden, isLinearError } from "../src/linear/errors.js";
import type { LinearClient } from "../src/linear/client.js";
import type { IssueNode } from "../src/linear/types.js";
import { createTestStore, NOW } from "./helpers/store.js";
import { formatEstimate, selectDetail } from "../src/select/detail.js";
import type { CommentRow, WorkflowStateRow } from "../src/store/rows.js";
import { issue as makeIssue, member, state } from "./helpers/store.js";

const ISSUE: IssueNode = {
  id: "i_1",
  identifier: "ENG-42",
  number: 42,
  title: "Fix the flaky login test",
  description: null,
  url: "https://linear.app/acme/issue/ENG-42",
  branchName: "ada/eng-42-fix",
  priority: 1,
  estimate: null,
  dueDate: null,
  sortOrder: 0,
  subIssueSortOrder: null,
  labelIds: ["l_bug"],
  previousIdentifiers: [],
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  triagedAt: null,
  archivedAt: null,
  createdAt: "2026-08-12T09:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
  team: { id: "team_eng" },
  state: { id: "s_progress" },
  assignee: null,
  creator: null,
  project: null,
  projectMilestone: null,
  cycle: null,
  parent: null,
};

function deps(
  overrides: Partial<LinearClient> = {},
): MutationDeps & { refusals: string[]; client: LinearClient } {
  const refusals: string[] = [];
  const client = {
    verify: vi.fn(),
    bootstrap: vi.fn(),
    teamGraph: vi.fn(),
    teamMembers: vi.fn(async () => ({ teams: { nodes: [] } })),
    backfillIssues: vi.fn(),
    tick: vi.fn(),
    notifications: vi.fn(),
    breadth: vi.fn(),
    createIssue: vi.fn(),
    createRelation: vi.fn(async () => ({
      issueRelationCreate: {
        success: true,
        issueRelation: {
          id: "rel_new",
          type: "related",
          issue: { id: "i_1", identifier: "ENG-42" },
          relatedIssue: { id: "i_2", identifier: "ENG-43" },
        },
      },
    })),
    linkUrl: vi.fn(),
    archiveIssue: vi.fn(),
    searchIssues: vi.fn(),
    createWebhook: vi.fn(),
    readWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    relations: vi.fn(),
    customViewIssues: vi.fn(),
    branchSearch: vi.fn(),
    teamAutomation: vi.fn(),
    attachmentsForUrl: vi.fn(),
    attachPullRequest: vi.fn(),
    issueDetail: vi.fn(),
    updateIssue: vi.fn(async () => ({ issueUpdate: { success: true, issue: ISSUE } })),
    createComment: vi.fn(async () => ({
      commentCreate: {
        success: true,
        comment: {
          id: "c_1",
          body: "Looks good",
          url: "https://linear.app/acme/issue/ENG-42#comment-c_1",
          createdAt: "2026-08-12T11:00:00.000Z",
          updatedAt: "2026-08-12T11:00:00.000Z",
          editedAt: null,
          resolvedAt: null,
          user: { id: "u_me" },
          parent: null,
          issue: { id: "i_1" },
        },
      },
    })),
    updateComment: vi.fn(async () => ({
      commentUpdate: {
        success: true,
        comment: {
          id: "c_1",
          body: "Edited",
          url: "https://linear.app/acme/issue/ENG-42#comment-c_1",
          createdAt: "2026-08-12T11:00:00.000Z",
          updatedAt: "2026-08-12T12:00:00.000Z",
          editedAt: "2026-08-12T12:00:00.000Z",
          resolvedAt: null,
          user: { id: "u_me" },
          parent: null,
          issue: { id: "i_1" },
        },
      },
    })),
    deleteComment: vi.fn(async () => ({
      commentDelete: { success: true, entityId: "c_1" },
    })),
    createReaction: vi.fn(async (input: { id: string; emoji: string }) => ({
      reactionCreate: {
        success: true,
        reaction: { id: input.id, emoji: input.emoji, user: { id: "u_me" } },
      },
    })),
    deleteReaction: vi.fn(async (id: string) => ({
      reactionDelete: { success: true, entityId: id },
    })),
    deleteRelation: vi.fn(async (id: string) => ({
      issueRelationDelete: { success: true, entityId: id },
    })),
    budget: () => null,
    breaker: () => ({ open: false, openUntil: 0, consecutiveFailures: 0, lastError: null }),
    ...overrides,
  } as unknown as LinearClient;

  return {
    // Every issue resolves to the same fake client here; the per-workspace
    // routing is exercised where it lives, against a real store.
    clientFor: () => client,
    store: createTestStore(),
    now: () => NOW,
    onWriteRefused: (what) => {
      refusals.push(what);
    },
    refusals,
    client,
  };
}

describe("buildIssueUpdateInput", () => {
  it("never emits labelIds", () => {
    // `labelIds` replaces the ENTIRE set, so a patch built from a read taken
    // thirty seconds ago silently deletes any label somebody added in
    // between — and the person who lost it has no way to know, because
    // nothing failed.
    const input = buildIssueUpdateInput({
      addLabelIds: ["l_bug"],
      removeLabelIds: ["l_ui"],
    });
    expect(input).toEqual({ addedLabelIds: ["l_bug"], removedLabelIds: ["l_ui"] });
    expect(Object.keys(input)).not.toContain("labelIds");
  });

  it("tells 'not part of this patch' apart from 'clear it'", () => {
    // Unassigning an issue and not touching its assignee are different
    // intentions, and both have to be expressible.
    expect(buildIssueUpdateInput({})).toEqual({});
    expect(buildIssueUpdateInput({ assigneeId: null })).toEqual({ assigneeId: null });
    expect(buildIssueUpdateInput({ assigneeId: "u_1" })).toEqual({ assigneeId: "u_1" });
  });

  it("maps milestone to Linear's own field name", () => {
    expect(buildIssueUpdateInput({ milestoneId: "m_1" })).toEqual({ projectMilestoneId: "m_1" });
  });

  it("passes parentId through, including null to clear it", () => {
    expect(buildIssueUpdateInput({ parentId: "i_parent" })).toEqual({ parentId: "i_parent" });
    expect(buildIssueUpdateInput({ parentId: null })).toEqual({ parentId: null });
  });

  it("drops empty label arrays rather than sending them", () => {
    expect(buildIssueUpdateInput({ addLabelIds: [], removeLabelIds: [] })).toEqual({});
  });
});

describe("updateIssue", () => {
  it("refuses an empty patch instead of spending a request on nothing", async () => {
    const d = deps();
    await expect(updateIssue(d, "i_1", {}, "x")).rejects.toThrow(/Nothing to change/);
    expect(d.client.updateIssue).not.toHaveBeenCalled();
  });

  it("applies the returned entity and records the echo before returning", async () => {
    // Echo suppression happens BEFORE the tick, not after. A tick that starts
    // the instant this resolves must already see both, or the user is
    // notified about the change they just made.
    const d = deps();
    await updateIssue(d, "i_1", { stateId: "s_progress" }, "x");
    expect(d.store.issue("i_1")?.identifier).toBe("ENG-42");
    expect(d.store.isEcho("i_1", Date.parse("2026-08-12T10:00:00.000Z"))).toBe(true);
  });

  it("does not suppress somebody else's later change to the same issue", () => {
    // The echo is keyed on (id, updatedAt), not on id: a different version of
    // the same entity is a different event and gets reported normally.
    const d = deps();
    d.store.recordEcho("i_1", 1000, NOW);
    expect(d.store.isEcho("i_1", 1000)).toBe(true);
    expect(d.store.isEcho("i_1", 2000)).toBe(false);
  });

  it("turns a permissions failure into the read-only sentence, and remembers it", async () => {
    const d = deps({
      updateIssue: vi.fn(async () => {
        throw forbidden("not allowed");
      }),
    });
    const error = await updateIssue(d, "i_1", { priority: 1 }, "ENG-42 wasn't changed").catch(
      (value: unknown) => value,
    );
    expect(isLinearError(error)).toBe(true);
    expect((error as Error).message).toContain("read-only");
    // The only evidence there will ever be: Linear does not expose a key's
    // scopes, so a refusal is discovered and then remembered.
    expect(d.refusals).toEqual(["this API key is read-only"]);
  });

  it("treats success: false with no errors as a failure", async () => {
    const d = deps({
      updateIssue: vi.fn(async () => ({ issueUpdate: { success: false, issue: null } })),
    });
    await expect(updateIssue(d, "i_1", { priority: 1 }, "move it")).rejects.toThrow(/didn't move it/);
  });
});

describe("postComment", () => {
  it("refuses an empty comment", async () => {
    const d = deps();
    await expect(
      postComment(d, { issueId: "i_1", body: "   ", clientId: "c" }),
    ).rejects.toThrow(/needs some text/);
  });

  it("sends a client-generated id, which is what makes a retry idempotent", async () => {
    const d = deps();
    await postComment(d, { issueId: "i_1", body: "Looks good", clientId: "fixed-id" });
    const call = (d.client.createComment as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      id: string;
      issueId: string;
      body: string;
    };
    expect(call.id).toBe("fixed-id");
    expect(call.body).toBe("Looks good");
  });

  it("writes the comment into the mirror so the pane is right immediately", async () => {
    const d = deps();
    await postComment(d, { issueId: "i_1", body: "Looks good", clientId: clientId() });
    expect(d.store.comments("i_1").map((row) => row.body)).toEqual(["Looks good"]);
  });
});

describe("pane comment and reaction mutations", () => {
  it("creates a reaction once, mirrors it, and toggles the same viewer reaction off", async () => {
    const d = deps();
    const added = await react(d, {
      issueId: "i_1",
      commentId: null,
      emoji: "👍",
      viewerId: "u_me",
    });
    expect(added.active).toBe(true);
    expect(d.store.reactionsFor("i_1")).toEqual([
      expect.objectContaining({ id: added.id, emoji: "👍", userId: "u_me", commentId: null }),
    ]);
    expect(d.client.createReaction).toHaveBeenCalledWith(
      expect.objectContaining({ id: added.id, issueId: "i_1", emoji: "👍" }),
      expect.anything(),
    );

    const removed = await react(d, {
      issueId: "i_1",
      commentId: null,
      emoji: "👍",
      viewerId: "u_me",
    });
    expect(removed).toEqual({ active: false, id: added.id });
    expect(d.client.deleteReaction).toHaveBeenCalledWith(added.id, expect.anything());
    expect(d.store.reactionsFor("i_1")).toEqual([]);
  });

  it("edits only the viewer's own comment and echoes the returned row", async () => {
    const d = deps();
    d.store.putComments([
      {
        id: "c_1", issueId: "i_1", userId: "u_me", parentId: null, body: "Before",
        url: null, createdAt: NOW, updatedAt: NOW, editedAt: null, resolvedAt: null,
      },
      {
        id: "c_other", issueId: "i_1", userId: "u_other", parentId: null, body: "No",
        url: null, createdAt: NOW, updatedAt: NOW, editedAt: null, resolvedAt: null,
      },
    ]);
    await editComment(d, { id: "c_1", body: " Edited ", viewerId: "u_me" });
    expect(d.client.updateComment).toHaveBeenCalledWith(
      "c_1",
      { body: "Edited" },
      expect.anything(),
    );
    expect(d.store.comment("c_1")?.body).toBe("Edited");
    await expect(
      editComment(d, { id: "c_other", body: "Changed", viewerId: "u_me" }),
    ).rejects.toThrow(/Only your own comments/);
  });

  it("deletes only the viewer's own comment and leaves replies orphaned at top level", async () => {
    const d = deps();
    d.store.putComments([
      {
        id: "c_1", issueId: "i_1", userId: "u_me", parentId: null, body: "Parent",
        url: null, createdAt: NOW, updatedAt: NOW, editedAt: null, resolvedAt: null,
      },
      {
        id: "c_reply", issueId: "i_1", userId: "u_other", parentId: "c_1", body: "Reply",
        url: null, createdAt: NOW + 1, updatedAt: NOW + 1, editedAt: null, resolvedAt: null,
      },
    ]);
    await expect(
      deleteComment(d, { id: "c_reply", viewerId: "u_me" }),
    ).rejects.toThrow(/Only your own comments/);
    await deleteComment(d, { id: "c_1", viewerId: "u_me" });
    expect(d.store.comment("c_1")).toBeNull();
    expect(d.store.comment("c_reply")?.parentId).toBeNull();
  });
});

describe("pane issue and relation mutations", () => {
  it("sets and clears parent through IssueUpdateInput", async () => {
    const d = deps();
    await setParent(d, { issueId: "i_1", parentId: "i_parent" });
    await setParent(d, { issueId: "i_1", parentId: null });
    expect(d.client.updateIssue).toHaveBeenNthCalledWith(
      1,
      "i_1",
      { parentId: "i_parent" },
      expect.anything(),
    );
    expect(d.client.updateIssue).toHaveBeenNthCalledWith(
      2,
      "i_1",
      { parentId: null },
      expect.anything(),
    );
  });

  it("passes parentId when creating a sub-issue", async () => {
    const d = deps({
      createIssue: vi.fn(async () => ({ issueCreate: { success: true, issue: ISSUE } })),
    });
    await createIssue(d, () => d.client, {
      teamId: "team_eng",
      title: "Sub-issue",
      parentId: "i_parent",
      clientId: "i_new",
    });
    expect(d.client.createIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i_new", parentId: "i_parent" }),
      expect.anything(),
    );
  });

  it("deletes a mirrored relation after Linear accepts it", async () => {
    const d = deps();
    d.store.mergeRelations([
      { id: "rel_1", issueId: "i_1", relatedIssueId: "i_2", type: "related" },
    ]);
    await unrelate(d, { relationId: "rel_1" });
    expect(d.client.deleteRelation).toHaveBeenCalledWith("rel_1", expect.anything());
    expect(d.store.relation("rel_1")).toBeNull();
  });

  it("mirrors a created relation and records its echo", async () => {
    const d = deps();
    await relateIssues(d, { issueId: "i_1", relatedIssueId: "i_2", type: "related" });
    expect(d.store.relation("rel_new")).toEqual({
      id: "rel_new", issueId: "i_1", relatedIssueId: "i_2", type: "related",
    });
    expect(d.store.isEcho("rel_new", NOW)).toBe(true);
  });
});

describe("attachUrl", () => {
  it("checks URL ownership by issue and mirrors the returned attachment", async () => {
    const setup = deps({
      attachmentsForUrl: vi.fn(async () => ({
        attachmentsForURL: {
          nodes: [{ id: "elsewhere", url: "https://example.com", issue: { id: "other", identifier: "ENG-1" } }],
        },
      })),
      linkUrl: vi.fn(async () => ({
        attachmentLinkURL: {
          success: true,
          attachment: {
            id: "a1", title: "Example", subtitle: null, url: "https://example.com",
            sourceType: null, groupBySource: false,
            createdAt: "2026-08-12T10:00:00.000Z",
            updatedAt: "2026-08-12T10:00:00.000Z",
            creator: { id: "u1" },
          },
        },
      })),
    });
    expect(await attachUrl(setup, { issueId: "i_1", url: "https://example.com", title: null }))
      .toEqual({ alreadyThere: false });
    expect(setup.client.linkUrl).toHaveBeenCalled();
    expect(setup.store.attachmentsFor("i_1")).toEqual([
      expect.objectContaining({ id: "a1", issueId: "i_1", title: "Example" }),
    ]);
    expect(setup.store.isEcho("a1", Date.parse("2026-08-12T10:00:00.000Z"))).toBe(true);
  });

  it("does not attach a URL already owned by the same issue", async () => {
    const setup = deps({
      attachmentsForUrl: vi.fn(async () => ({
        attachmentsForURL: {
          nodes: [{ id: "a1", url: "https://example.com", issue: { id: "i_1", identifier: "ENG-42" } }],
        },
      })),
    });
    expect(await attachUrl(setup, { issueId: "i_1", url: "https://example.com", title: null }))
      .toEqual({ alreadyThere: true });
    expect(setup.client.linkUrl).not.toHaveBeenCalled();
  });
});

describe("clientId", () => {
  it("is unique per call", () => {
    expect(clientId()).not.toBe(clientId());
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe("formatEstimate", () => {
  it("does not say 'points' on a t-shirt team", () => {
    // Rendering "3 points" on a t-shirt team is wrong in a way that makes the
    // whole panel look like it does not know the workspace.
    expect(formatEstimate(3, "tShirt")).toBe("M");
    expect(formatEstimate(3, "fibonacci")).toBe("3 points");
    expect(formatEstimate(1, "linear")).toBe("1 point");
  });

  it("renders nothing at all when the team does not estimate", () => {
    expect(formatEstimate(3, "notUsed")).toBeNull();
    expect(formatEstimate(null, "fibonacci")).toBeNull();
  });

  it("falls back to the number on a scale value it does not recognise", () => {
    expect(formatEstimate(21, "tShirt")).toBe("21");
  });
});

describe("selectDetail", () => {
  const states: WorkflowStateRow[] = [
    state("s_done", "team_eng", "completed", 1, "Done"),
    state("s_triage", "team_eng", "triage", 1, "Triage"),
    state("s_progress", "team_eng", "started", 2, "In Progress"),
  ];

  function context(overrides: Record<string, unknown> = {}) {
    return {
      issue: { ...makeIssue({ id: "i_1", stateId: "s_progress" }), syncedAt: NOW },
      writable: true,
      writableTeamIds: new Set(["team_eng"]),
      team: {
        id: "team_eng",
        key: "ENG",
        name: "Engineering",
        icon: null,
        color: null,
        parentId: null,
        estimationType: "notUsed",
        estimationAllowZero: false,
        estimationExtended: false,
        defaultEstimate: 0,
        cyclesEnabled: false,
        triageEnabled: true,
        activeCycleId: null,
        updatedAt: NOW,
        fetchedAt: NOW,
      },
      states,
      members: new Map([["u_me", member("u_me", "Ada Lovelace", true)]]),
      labels: new Map(),
      priorityLabels: new Map([[0, "No priority"]]),
      comments: [] as CommentRow[],
      commentsTruncated: false,
      subIssues: [],
      projectName: null,
      cycleName: null,
      milestoneName: null,
      attachments: [],
      relations: [],
      history: [],
      reactions: [],
      subscribers: [],
      documents: [],
      needs: [],
      parent: null,
      lastOpenedAt: null,
      showActivity: true,
      viewerId: null,
      cursors: null,
      now: NOW,
      vocabulary: {
        states: new Map(),
        members: new Map(),
        priorities: new Map(),
        projects: new Map(),
        cycles: new Map(),
        issues: new Map(),
        labels: new Map(),
        teams: new Map(),
        milestones: new Map(),
        estimationType: "notUsed",
      },
      ...overrides,
    };
  }

  it("orders the state picker by type then position, which is Linear's order", () => {
    const view = selectDetail(context() as never);
    expect(view.stateOptions.map((option) => option.name)).toEqual([
      "Triage",
      "In Progress",
      "Done",
    ]);
  });

  it("hides the estimate entirely on a team that does not estimate", () => {
    const view = selectDetail(context() as never);
    expect(view.usesEstimates).toBe(false);
    expect(view.properties.find((property) => property.key === "estimate")).toBeUndefined();
  });

  it("renders no property that has no value", () => {
    // A pane full of "Assignee: —" rows is a pane that has to be read past
    // rather than read.
    const view = selectDetail(context() as never);
    expect(view.properties.map((property) => property.key)).toEqual(["priority"]);
  });
});
