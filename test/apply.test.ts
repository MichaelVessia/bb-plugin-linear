import { describe, expect, it } from "vitest";
import type {
  IssueDetailNode,
  IssueHistoryNode,
  IssueNode,
  TickIssueNode,
} from "../src/linear/types.js";
import { applyIssueDetail, applyIssues } from "../src/sync/apply.js";
import { createTestStore, NOW, team } from "./helpers/store.js";

const ISO = new Date(NOW).toISOString();

function issueNode(overrides: Partial<IssueNode> = {}): IssueNode {
  return {
    id: "i1",
    identifier: "ENG-1",
    number: 1,
    title: "Issue",
    description: null,
    url: "https://linear.app/issue/ENG-1",
    branchName: "eng-1",
    priority: 2,
    estimate: 3,
    dueDate: null,
    sortOrder: 0,
    subIssueSortOrder: null,
    labelIds: [],
    previousIdentifiers: [],
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    triagedAt: null,
    archivedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
    team: { id: "team_eng" },
    state: { id: "started" },
    assignee: null,
    creator: { id: "u1" },
    project: null,
    projectMilestone: null,
    cycle: null,
    parent: { id: "parent", identifier: "ENG-0", title: "Parent" },
    ...overrides,
  };
}

function historyNode(): IssueHistoryNode {
  return {
    id: "h1",
    createdAt: ISO,
    actorId: "u1",
    actor: { id: "u1" },
    botActor: null,
    fromStateId: "todo",
    toStateId: "started",
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
  };
}

function detailNode(): IssueDetailNode {
  return {
    ...issueNode(),
    priorityLabel: "High",
    team: { id: "team_eng", key: "ENG", name: "Engineering", issueEstimationType: "fibonacci" },
    children: { nodes: [], pageInfo: { hasNextPage: false } },
    comments: {
      nodes: [
        {
          id: "c1",
          body: "Comment",
          url: "https://linear.app/comment/c1",
          createdAt: ISO,
          updatedAt: ISO,
          editedAt: null,
          resolvedAt: ISO,
          resolvingUser: { id: "u2" },
          user: { id: "u1" },
          parent: null,
          issue: { id: "i1" },
          reactions: [{ id: "cr1", emoji: "eyes", createdAt: ISO, user: { id: "u2" } }],
        },
      ],
      pageInfo: {
        hasNextPage: true,
        endCursor: "comments-end",
        hasPreviousPage: true,
        startCursor: "comments-start",
      },
    },
    attachments: {
      nodes: [
        {
          id: "a1",
          title: "Spec",
          subtitle: "Link",
          url: "https://example.invalid/spec",
          sourceType: "link",
          groupBySource: true,
          createdAt: ISO,
          updatedAt: ISO,
          creator: { id: "u1" },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    relations: {
      nodes: [
        {
          id: "rel-out",
          type: "related",
          relatedIssue: {
            id: "i2",
            identifier: "ENG-2",
            title: "Related",
            state: { id: "started", type: "started" },
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    inverseRelations: {
      nodes: [
        {
          id: "rel-in",
          type: "blocks",
          issue: {
            id: "i3",
            identifier: "ENG-3",
            title: "Blocker",
            state: { id: "started", type: "started" },
          },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    history: {
      nodes: [historyNode()],
      pageInfo: {
        hasNextPage: true,
        endCursor: "history-end",
        hasPreviousPage: true,
        startCursor: "history-start",
      },
    },
    reactions: [{ id: "ir1", emoji: "thumbsup", createdAt: ISO, user: { id: "u1" } }],
    subscribers: { nodes: [{ id: "u1" }, { id: "u2" }], pageInfo: { hasNextPage: false } },
    documents: {
      nodes: [
        {
          id: "d1",
          title: "Decision",
          url: "https://example.invalid/doc",
          updatedAt: ISO,
          icon: null,
          color: null,
        },
      ],
      pageInfo: { hasNextPage: false },
    },
    needs: {
      nodes: [
        {
          id: "n1",
          body: "Please ship",
          priority: 2,
          url: "https://example.invalid/need",
          createdAt: ISO,
          customer: { id: "customer", name: "Customer" },
        },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
}

describe("applyIssueDetail", () => {
  it("writes every pane table, reconciles the fetched comment window, and stores cursors", () => {
    const store = createTestStore();
    store.putComments([
      {
        id: "older",
        issueId: "i1",
        userId: null,
        parentId: null,
        body: "Older",
        url: null,
        createdAt: NOW - 100,
        updatedAt: NOW - 100,
        editedAt: null,
        resolvedAt: null,
        resolvingUserId: null,
      },
      {
        id: "deleted-in-window",
        issueId: "i1",
        userId: null,
        parentId: null,
        body: "Deleted",
        url: null,
        createdAt: NOW,
        updatedAt: NOW,
        editedAt: null,
        resolvedAt: null,
        resolvingUserId: null,
      },
    ]);

    applyIssueDetail(store, detailNode(), NOW);

    expect(store.comments("i1").map((row) => row.id)).toEqual(["older", "c1"]);
    expect(store.comments("i1")[1]?.resolvingUserId).toBe("u2");
    expect(store.attachmentsFor("i1").map((row) => row.id)).toEqual(["a1"]);
    expect(store.relationsFor("i1").map((row) => row.id).sort()).toEqual(["rel-in", "rel-out"]);
    expect(store.blockersFor(["i1"]).get("i1")).toEqual(["ENG-3"]);
    expect(store.historyFor("i1").map((row) => row.id)).toEqual(["h1:state"]);
    expect(store.reactionsFor("i1").map((row) => row.id).sort()).toEqual(["cr1", "ir1"]);
    expect(store.subscribersFor("i1")).toEqual(["u1", "u2"]);
    expect(store.documentsFor("i1").map((row) => row.id)).toEqual(["d1"]);
    expect(store.customerNeedsFor("i1").map((row) => row.id)).toEqual(["n1"]);
    expect(store.activityCursor("i1")).toEqual({
      issueId: "i1",
      commentsCursor: "comments-end",
      commentsMore: true,
      historyCursor: "history-end",
      historyMore: true,
      direction: "after",
    });
    expect(
      store.queryIssues({ teamIds: ["team_eng"], sort: "updated", limit: 10 }).map((row) => row.id),
    ).toEqual(["i1"]);
    expect(
      store.queryIssues({
        teamIds: ["team_eng"],
        text: "Parent",
        sort: "updated",
        limit: 10,
      }),
    ).toEqual([]);
  });

  it("merges tick attachments and both relation directions", () => {
    const store = createTestStore();
    const tick = {
      ...issueNode({ parent: null }),
      attachments: {
        nodes: [
          {
            id: "a1",
            title: "Attachment",
            subtitle: null,
            url: "https://example.invalid/a",
            sourceType: null,
            groupBySource: false,
            createdAt: ISO,
            updatedAt: ISO,
            creator: null,
          },
        ],
        pageInfo: { hasNextPage: false },
      },
      relations: {
        nodes: [{ id: "r1", type: "related", relatedIssue: { id: "i2" } }],
        pageInfo: { hasNextPage: false },
      },
      inverseRelations: {
        nodes: [{ id: "r2", type: "blocks", issue: { id: "i3" } }],
        pageInfo: { hasNextPage: false },
      },
    } satisfies TickIssueNode;

    applyIssues(store, [tick], NOW);
    expect(store.attachmentsFor("i1").map((row) => row.id)).toEqual(["a1"]);
    expect(store.relationsFor("i1").map((row) => row.id).sort()).toEqual(["r1", "r2"]);
  });

  it("does not invent a source-team issue stub for an unresolved cross-team relation", () => {
    const store = createTestStore();
    const node = detailNode();

    applyIssueDetail(
      store,
      {
        ...node,
        relations: {
          nodes: [
            {
              id: "cross-team",
              type: "related",
              relatedIssue: {
                id: "ops-2",
                identifier: "OPS-2",
                title: "Operations issue",
                state: { id: "ops-open", type: "started" },
              },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
        inverseRelations: { nodes: [], pageInfo: { hasNextPage: false } },
      },
      NOW,
    );

    expect(store.issue("ops-2")).toBeNull();
    expect(store.relationsFor("i1")).toEqual([
      expect.objectContaining({ id: "cross-team", counterpartId: "ops-2", identifier: null }),
    ]);
  });

  it("never resolves a relation stub through another workspace's same-key team", () => {
    const store = createTestStore();
    store.putWorkspace(
      {
        id: "ws_a",
        slot: "apiKey",
        name: "Workspace A",
        urlKey: "workspace-a",
        viewerId: "user-a",
        viewerName: "User A",
        gitBranchFormat: null,
      },
      NOW,
    );
    store.putWorkspace(
      {
        id: "ws_b",
        slot: "apiKey2",
        name: "Workspace B",
        urlKey: "workspace-b",
        viewerId: "user-b",
        viewerName: "User B",
        gitBranchFormat: null,
      },
      NOW,
    );
    store.putTeams(
      [
        team("a_prod", "PROD", { workspaceId: "ws_a" }),
        team("b_eng", "ENG", { workspaceId: "ws_b" }),
      ],
      NOW,
    );
    const node = detailNode();

    applyIssueDetail(
      store,
      {
        ...node,
        id: "a-prod-1",
        identifier: "PROD-1",
        number: 1,
        title: "Workspace A source",
        team: {
          id: "a_prod",
          key: "PROD",
          name: "Product",
          issueEstimationType: "fibonacci",
        },
        parent: null,
        comments: {
          nodes: [],
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
        },
        relations: {
          nodes: [
            {
              id: "a-relation",
              type: "related",
              relatedIssue: {
                id: "a-eng-5",
                identifier: "ENG-5",
                title: "Workspace A private title",
                state: { id: "a-open", type: "started" },
              },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
        inverseRelations: { nodes: [], pageInfo: { hasNextPage: false } },
      },
      NOW,
    );

    expect(store.issue("a-eng-5")).toBeNull();

    applyIssues(
      store,
      [
        issueNode({
          id: "b-eng-5",
          identifier: "ENG-5",
          number: 5,
          title: "Workspace B title",
          team: { id: "b_eng" },
          parent: null,
        }),
      ],
      NOW + 1,
    );
    expect(store.issueByIdentifier("ENG-5")).toEqual(
      expect.objectContaining({ id: "b-eng-5", title: "Workspace B title" }),
    );
  });

  it("keeps child stubs visible while parent and relation stubs stay out of list surfaces", () => {
    const store = createTestStore();
    const node = detailNode();

    applyIssueDetail(
      store,
      {
        ...node,
        children: {
          nodes: [
            {
              id: "child-1",
              identifier: "ENG-4",
              title: "Visible child",
              state: { id: "started", type: "started" },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
      NOW,
    );

    expect(
      store
        .queryIssues({ teamIds: ["team_eng"], sort: "updated", limit: 10 })
        .map((issue) => issue.id)
        .sort(),
    ).toEqual(["child-1", "i1"]);
    expect(store.countIssues({ teamIds: ["team_eng"], includeCompleted: true })).toBe(2);
    expect(
      store.queryIssues({
        teamIds: ["team_eng"],
        text: "Visible child",
        sort: "updated",
        limit: 10,
      }),
    ).toEqual([expect.objectContaining({ id: "child-1" })]);
  });

  it("does not claim the source issue creation time for parent and relation stubs", () => {
    const store = createTestStore();

    applyIssueDetail(store, detailNode(), NOW);

    expect(store.issue("parent")?.createdAt).toBeNull();
    expect(store.issue("i2")?.createdAt).toBeNull();
    expect(store.issue("i3")?.createdAt).toBeNull();
  });

  it("keeps reactions on comments outside the fetched detail window", () => {
    const store = createTestStore();
    store.putComments([
      {
        id: "older-comment",
        issueId: "i1",
        userId: null,
        parentId: null,
        body: "Older",
        url: null,
        createdAt: NOW - 100,
        updatedAt: NOW - 100,
        editedAt: null,
        resolvedAt: null,
        resolvingUserId: null,
      },
    ]);
    store.replaceReactions("i1", [
      {
        id: "older-comment-reaction",
        issueId: "i1",
        commentId: "older-comment",
        emoji: "heart",
        userId: "u3",
        createdAt: NOW - 100,
      },
      {
        id: "stale-fetched-comment-reaction",
        issueId: "i1",
        commentId: "c1",
        emoji: "confused",
        userId: "u3",
        createdAt: NOW - 1,
      },
      {
        id: "stale-issue-reaction",
        issueId: "i1",
        commentId: null,
        emoji: "eyes",
        userId: "u3",
        createdAt: NOW - 1,
      },
    ]);

    applyIssueDetail(store, detailNode(), NOW);

    expect(store.reactionsFor("i1").map((reaction) => reaction.id).sort()).toEqual([
      "cr1",
      "ir1",
      "older-comment-reaction",
    ]);
  });

  it("removes stale comments when the fetched activity window is completely empty", () => {
    const store = createTestStore();
    store.putComments([
      {
        id: "deleted-final-comment",
        issueId: "i1",
        userId: null,
        parentId: null,
        body: "Deleted",
        url: null,
        createdAt: NOW,
        updatedAt: NOW,
        editedAt: null,
        resolvedAt: null,
        resolvingUserId: null,
      },
    ]);
    const node = detailNode();

    applyIssueDetail(
      store,
      {
        ...node,
        comments: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
        },
      },
      NOW,
    );

    expect(store.comments("i1")).toEqual([]);
  });

  it("preserves nullable customer-need fields from the vendored SDL", () => {
    const store = createTestStore();
    const node = detailNode();

    applyIssueDetail(
      store,
      {
        ...node,
        needs: {
          nodes: [
            {
              id: "need-without-source",
              body: null,
              priority: 0,
              url: null,
              createdAt: ISO,
              customer: null,
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      },
      NOW,
    );

    expect(store.customerNeedsFor("i1")).toEqual([
      expect.objectContaining({
        id: "need-without-source",
        customerName: null,
        body: null,
        url: null,
      }),
    ]);
  });
});
