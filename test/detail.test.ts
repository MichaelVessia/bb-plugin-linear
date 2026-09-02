import { describe, expect, it } from "vitest";
import { detailViewSchema } from "../src/contract.js";
import { selectDetail } from "../src/select/detail.js";
import { issue, member, NOW, state, team } from "./helpers/store.js";

describe("selectDetail pane parity", () => {
  it("projects the widened contract entirely from mirror-shaped rows", () => {
    const jane = member("u1", "Jane Doe", true);
    const context = {
      issue: {
        ...issue({
          id: "i1",
          identifier: "ENG-1",
          description:
            "Ask @[Jane Doe](u1) ![shot](https://uploads.linear.app/shot.png)",
          stateId: "s1",
          creatorId: "u1",
          parentId: "p1",
          createdAt: NOW,
        }),
        syncedAt: NOW,
      },
      writable: true,
      writableTeamIds: new Set(["team_eng"]),
      team: { ...team("team_eng", "ENG"), fetchedAt: NOW },
      states: [
        { ...state("s1", "team_eng", "started", 1, "Building"), color: "#5E6AD2" },
        { ...state("done", "team_eng", "completed", 2, "Done"), color: "#44AA66" },
      ],
      members: new Map([["u1", jane]]),
      labels: new Map(),
      priorityLabels: new Map([[0, "None"]]),
      comments: [{
        id: "c1",
        issueId: "i1",
        userId: "u1",
        parentId: null,
        body: "Hello @[Jane](u1)",
        url: null,
        createdAt: NOW + 20,
        updatedAt: NOW + 20,
        editedAt: null,
        resolvedAt: NOW + 30,
        resolvingUserId: "u1",
      }],
      commentsTruncated: true,
      subIssues: [{
        id: "child",
        identifier: "ENG-2",
        title: "Verify the glyph",
        stateId: "done",
        type: "completed",
      }],
      projectName: "Glyph parity",
      projectGlyph: { type: "started", color: "#5E6AD2", progress: 0.625 },
      cycleName: null,
      milestoneName: null,
      attachments: [{
        id: "a1", issueId: "i1", title: "PR", subtitle: "#1", url: "https://example.com/pr",
        sourceType: "github", groupBySource: true, createdAt: NOW + 10, updatedAt: NOW + 10,
        creatorId: "u1",
      }],
      relations: [{
        id: "r1", issueId: "p1", relatedIssueId: "i1", type: "blocks", inverse: true,
        counterpartId: "p1", counterpartTeamId: "team_eng", identifier: "ENG-0", title: "Parent blocker", stateId: "s1",
        stateType: "started",
      }, {
        id: "r2", issueId: "i1", relatedIssueId: "ops1", type: "related", inverse: false,
        counterpartId: "ops1", counterpartTeamId: "team_ops", identifier: "OPS-1", title: "Operations", stateId: null,
        stateType: null,
      }],
      history: [{
        id: "h1:description", issueId: "i1", createdAt: NOW + 5, actorId: "u1", botName: null,
        kind: "description", payload: {},
      }],
      reactions: [{
        id: "rx1", issueId: "i1", commentId: null, emoji: "👍", userId: "u1", createdAt: NOW,
      }, {
        id: "rx2", issueId: "i1", commentId: "c1", emoji: "❤️", userId: "u1", createdAt: NOW,
      }],
      subscribers: [jane],
      documents: [{ id: "d1", issueId: "i1", title: "Spec", url: "https://example.com/spec", updatedAt: NOW, icon: null, color: null }],
      needs: [{ id: "n1", issueId: "i1", customerName: "Acme", priority: 2, body: "Needs this soon", url: null, createdAt: NOW }],
      parent: { id: "p1", identifier: "ENG-0", title: "Parent", tone: "started" },
      lastOpenedAt: NOW - 1,
      showActivity: false,
      viewerId: "u1",
      cursors: { issueId: "i1", commentsCursor: "c", commentsMore: true, historyCursor: "h", historyMore: false, direction: "after" },
      now: NOW + 60,
      vocabulary: {
        states: new Map([["s1", "Building"]]), members: new Map([["u1", "Jane Doe"]]),
        priorities: new Map([[0, "None"]]), projects: new Map(), cycles: new Map(),
        issues: new Map([["p1", "ENG-0"]]), labels: new Map(), teams: new Map(),
        milestones: new Map(), estimationType: "notUsed",
      },
    };

    const view = selectDetail(context as never);
    expect(() => detailViewSchema.parse(view)).not.toThrow();
    expect(view.writable).toBe(true);
    expect(view.teamId).toBe("team_eng");
    expect(view.description).toContain("**@Jane Doe**");
    expect(view.description).toContain("/api/v1/plugins/linear/http/image?");
    expect(view.descriptionSource).toContain("@[Jane Doe](u1)");
    expect(view.parent?.identifier).toBe("ENG-0");
    expect(view.resources.groups.map((group) => group.label)).toEqual(["GitHub", "Documents"]);
    expect(view.relations.blockedBy[0]?.identifier).toBe("ENG-0");
    expect(view.relations.blockedBy[0]?.removable).toBe(true);
    expect(view.relations.related[0]?.removable).toBe(false);
    expect(view.reactions[0]).toMatchObject({ emoji: "👍", count: 1, mine: true });
    expect(view.comments[0]).toMatchObject({ resolved: true, resolvedBy: "Jane Doe", mine: true });
    expect(view.comments[0]?.bodySource).toBe("Hello @[Jane](u1)");
    expect(view.comments[0]?.reactions[0]?.emoji).toBe("❤️");
    expect(view.subscribers).toMatchObject({ count: 1 });
    expect(view.customerRequests[0]).toMatchObject({ customer: "Acme", priority: 2 });
    expect(view.timeline.map((entry) => entry.kind)).toEqual(["event", "event", "comment"]);
    expect(view.unreadBoundaryAt).toBe(NOW - 1);
    expect(view.activity).toEqual({ showActivity: false, hasOlder: true });
    expect(view).toMatchObject({
      stateColor: "#5E6AD2",
      glyph: { pie: 0.5, color: "#5E6AD2" },
      completedStateColor: "#44AA66",
      fields: {
        projectGlyph: { type: "started", color: "#5E6AD2", progress: 0.625 },
      },
    });
    expect(view.properties.find((property) => property.key === "project")?.projectGlyph)
      .toEqual({ type: "started", color: "#5E6AD2", progress: 0.625 });
    expect(view.subIssues[0]).toMatchObject({
      done: true,
      glyph: { disc: true, mark: "check", color: "#44AA66" },
    });
  });
});
