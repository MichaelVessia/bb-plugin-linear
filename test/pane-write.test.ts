import { describe, expect, it } from "vitest";
import { rpcContract } from "../src/contract.js";
import {
  mentionCandidates,
  relationCreateInput,
  searchIssuesForPicker,
} from "../src/pane-write.js";
import { serverRpcContract } from "../src/rpc.js";
import { createTestStore, issue, member, NOW, state, team } from "./helpers/store.js";

describe("pane write rpc contract", () => {
  it("widens existing strict inputs without renaming them", () => {
    expect(rpcContract.updateIssue.input.safeParse({ id: "i1", parentId: null }).success).toBe(true);
    expect(rpcContract.createIssue.input.safeParse({
      teamId: "t1", title: "Child", parentId: "parent",
    }).success).toBe(true);
    expect(rpcContract.comment.input.safeParse({
      issueId: "i1", body: "Reply", parentId: "comment",
    }).success).toBe(true);
  });

  it("exports every new rpc through the server contract", () => {
    for (const name of [
      "react",
      "editComment",
      "deleteComment",
      "setParent",
      "unrelate",
      "relate",
      "attachLink",
      "searchIssuesForPicker",
      "mentionCandidates",
    ] as const) {
      expect(serverRpcContract[name]).toBe(rpcContract[name]);
    }
  });

  it("keeps new inputs strict and relation types bounded", () => {
    expect(rpcContract.react.input.safeParse({
      issueId: "i1", emoji: "👍", surprise: true,
    }).success).toBe(false);
    expect(rpcContract.relate.input.safeParse({
      issueId: "i1", relatedIssueId: "i2", type: "similar",
    }).success).toBe(false);
    expect(rpcContract.relate.input.safeParse({
      issueId: "i1", relatedIssueId: "i2", type: "blockedBy",
    }).success).toBe(true);
  });
});

describe("pane relation direction", () => {
  it("maps inverse labels by swapping ids and using Linear's enum", () => {
    expect(relationCreateInput({ issueId: "a", relatedIssueId: "b", type: "blockedBy" }))
      .toEqual({ issueId: "b", relatedIssueId: "a", type: "blocks" });
    expect(relationCreateInput({ issueId: "a", relatedIssueId: "b", type: "duplicateOf" }))
      .toEqual({ issueId: "a", relatedIssueId: "b", type: "duplicate" });
    expect(relationCreateInput({ issueId: "a", relatedIssueId: "b", type: "related" }))
      .toEqual({ issueId: "a", relatedIssueId: "b", type: "related" });
  });
});

describe("mirror-only picker projections", () => {
  it("bounds issue search to twenty rows and projects state tone", () => {
    const store = createTestStore();
    store.putTeams([team("team_eng", "ENG"), team("team_other", "OTHER")], NOW);
    store.replaceWorkflowStates("team_eng", [state("doing", "team_eng", "started")]);
    store.putIssues([
      ...Array.from({ length: 25 }, (_, index) => issue({
        id: `i${index}`,
        identifier: `ENG-${index}`,
        title: `Picker match ${index}`,
        stateId: "doing",
        updatedAt: NOW + index,
      })),
      issue({
        id: "other",
        identifier: "OTHER-1",
        teamId: "team_other",
        title: "Picker match outside scope",
      }),
    ], NOW);
    const rows = searchIssuesForPicker(store, "team_eng", "Picker match");
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.identifier.startsWith("ENG-"))).toBe(true);
    expect(rows.every((row) => row.tone === "started")).toBe(true);
    expect(rows.every((row) => row.glyph.pie === 0.5)).toBe(true);
  });

  it("filters team members and caps mention candidates at ten", () => {
    const store = createTestStore();
    store.putTeams([team("team_eng", "ENG")], NOW);
    const members = Array.from({ length: 12 }, (_, index) =>
      member(`u${index}`, `Person ${String(index).padStart(2, "0")}`),
    );
    store.putMembers(members);
    store.replaceTeamMembers("team_eng", members.map((entry) => entry.id));
    expect(mentionCandidates(store, "team_eng", "Person")).toHaveLength(10);
    expect(mentionCandidates(store, "team_eng", "Person 11")).toEqual([
      { id: "u11", displayName: "Person 11", handle: "Person 11" },
    ]);
  });
});
