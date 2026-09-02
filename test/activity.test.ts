import { describe, expect, it, vi } from "vitest";
import {
  LAST_OPENED_LIMIT,
  loadOlderActivity,
  PANE_OPEN_SESSION_MS,
  readPanePreferences,
} from "../src/activity.js";
import { createVersionedStore, KV } from "../src/kv.js";
import { createTestStore, NOW } from "./helpers/store.js";

describe("loadOlderActivity", () => {
  it("pages with persisted after cursors, writes through, and advances both lanes", async () => {
    const store = createTestStore();
    store.putActivityCursor({
      issueId: "i1",
      commentsCursor: "comments-1",
      commentsMore: true,
      historyCursor: "history-1",
      historyMore: true,
      direction: "after",
    });
    store.replaceReactions("i1", [{
      id: "issue-reaction", issueId: "i1", commentId: null, emoji: "eyes",
      userId: "u1", createdAt: NOW,
    }]);
    const issueActivityPage = vi.fn(async () => ({
      issue: {
        id: "i1",
        comments: {
          nodes: [{
            id: "c-old",
            body: "Older",
            url: "https://linear.app/comment/c-old",
            createdAt: "2023-11-14T20:00:00.000Z",
            updatedAt: "2023-11-14T20:00:00.000Z",
            editedAt: null,
            resolvedAt: null,
            resolvingUser: null,
            user: null,
            parent: null,
            issue: { id: "i1" },
            reactions: [],
          }],
          pageInfo: { hasNextPage: false, endCursor: "comments-2" },
        },
        history: {
          nodes: [{
            id: "h-old",
            createdAt: "2023-11-14T19:00:00.000Z",
            actorId: null,
            actor: null,
            botActor: null,
            fromStateId: "s1",
            toStateId: "s2",
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
          }],
          pageInfo: { hasNextPage: false, endCursor: "history-2" },
        },
      },
    }));

    const result = await loadOlderActivity({
      issueId: "i1",
      store,
      client: { issueActivityPage } as never,
      now: () => NOW,
    });

    expect(issueActivityPage).toHaveBeenCalledWith(
      "i1",
      { commentsAfter: "comments-1", historyAfter: "history-1" },
      { initiator: "user" },
    );
    expect(store.comments("i1").map((comment) => comment.id)).toEqual(["c-old"]);
    expect(store.historyFor("i1").map((event) => event.id)).toEqual(["h-old:state"]);
    expect(store.reactionsFor("i1").map((reaction) => reaction.id)).toContain("issue-reaction");
    expect(store.activityCursor("i1")).toMatchObject({
      commentsCursor: "comments-2",
      commentsMore: false,
      historyCursor: "history-2",
      historyMore: false,
      direction: "after",
    });
    expect(result).toEqual({ ok: true, hasOlder: false });
  });

  it("does not fetch when both lanes are exhausted", async () => {
    const store = createTestStore();
    store.putActivityCursor({
      issueId: "i1",
      commentsCursor: "c",
      commentsMore: false,
      historyCursor: "h",
      historyMore: false,
      direction: "after",
    });
    const issueActivityPage = vi.fn();
    expect(
      await loadOlderActivity({
        issueId: "i1",
        store,
        client: { issueActivityPage } as never,
        now: () => NOW,
      }),
    ).toEqual({ ok: true, hasOlder: false });
    expect(issueActivityPage).not.toHaveBeenCalled();
  });

  it("does not let an exhausted lane's empty refetch erase mirrored comments", async () => {
    const store = createTestStore();
    store.putComments([{
      id: "kept", issueId: "i1", userId: null, parentId: null, body: "Keep",
      url: null, createdAt: NOW, updatedAt: NOW, editedAt: null, resolvedAt: null,
      resolvingUserId: null,
    }]);
    store.putActivityCursor({
      issueId: "i1",
      commentsCursor: "comments-final",
      commentsMore: false,
      historyCursor: "history-1",
      historyMore: true,
      direction: "after",
    });
    const issueActivityPage = vi.fn(async () => ({
      issue: {
        id: "i1",
        comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        history: { nodes: [], pageInfo: { hasNextPage: false, endCursor: "history-final" } },
      },
    }));
    expect(await loadOlderActivity({
      issueId: "i1", store, client: { issueActivityPage } as never, now: () => NOW,
    })).toEqual({ ok: true, hasOlder: false });
    expect(store.comments("i1").map((comment) => comment.id)).toEqual(["kept"]);
    expect(store.activityCursor("i1")).toMatchObject({
      commentsCursor: "comments-final",
      commentsMore: false,
      historyCursor: "history-final",
      historyMore: false,
    });
  });

  it("does not let an empty final older page erase the mirrored comment window", async () => {
    const store = createTestStore();
    store.putComments([{
      id: "kept", issueId: "i1", userId: null, parentId: null, body: "Keep",
      url: null, createdAt: NOW, updatedAt: NOW, editedAt: null, resolvedAt: null,
      resolvingUserId: null,
    }]);
    store.putActivityCursor({
      issueId: "i1", commentsCursor: "comments-1", commentsMore: true,
      historyCursor: null, historyMore: false, direction: "after",
    });
    const issueActivityPage = vi.fn(async () => ({
      issue: {
        id: "i1",
        comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        history: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    }));
    await loadOlderActivity({
      issueId: "i1", store, client: { issueActivityPage } as never, now: () => NOW,
    });
    expect(store.comments("i1").map((comment) => comment.id)).toEqual(["kept"]);
  });
});

describe("pane open preferences", () => {
  it("returns the prior boundary, advances it, and prunes the index to 500", async () => {
    const values = new Map<string, unknown>();
    const ids = Array.from({ length: LAST_OPENED_LIMIT }, (_, index) => `old-${index}`);
    values.set(KV.lastOpenedIndex, { v: 1, ids });
    values.set(KV.lastOpened("current"), { v: 1, at: NOW - 10 });
    values.set(KV.activityVisibility, { v: 1, showActivity: false });
    for (const id of ids) values.set(KV.lastOpened(id), { v: 1, at: NOW - 100 });
    const set = vi.fn(async (key: string, value: unknown) => { values.set(key, value); });
    const kv = createVersionedStore({
      get: async (key: string) => values.get(key),
      set,
      delete: async (key: string) => { values.delete(key); },
      list: async () => [...values.keys()],
    } as never);

    expect(await readPanePreferences({ kv, issueId: "current", now: () => NOW, advanceOpened: true }))
      .toEqual({ lastOpenedAt: NOW - 10, showActivity: false });
    expect(values.get(KV.lastOpened("current"))).toEqual({ v: 1, at: NOW, boundary: NOW - 10 });
    expect((values.get(KV.lastOpenedIndex) as { ids: string[] }).ids).toHaveLength(500);
    expect((values.get(KV.lastOpenedIndex) as { ids: string[] }).ids.at(-1)).toBe("current");
    expect(values.has(KV.lastOpened("old-0"))).toBe(false);

    const writesAfterOpen = set.mock.calls.length;
    expect(await readPanePreferences({
      kv, issueId: "current", now: () => NOW + 1_000, advanceOpened: true,
    })).toEqual({ lastOpenedAt: NOW - 10, showActivity: false });
    expect(set).toHaveBeenCalledTimes(writesAfterOpen);

    expect(await readPanePreferences({
      kv,
      issueId: "current",
      now: () => NOW + PANE_OPEN_SESSION_MS + 1,
      advanceOpened: true,
    })).toEqual({ lastOpenedAt: NOW, showActivity: false });
  });
});
