import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { issueNeedsRefresh, registerTools, toolsFor } from "../src/tools.js";
import { createTestStore, issue, member, NOW, team } from "./helpers/store.js";

describe("agent issue resolution", () => {
  it("refreshes detached parent and relation placeholders before returning detail", () => {
    expect(issueNeedsRefresh(issue({ id: "stub", number: 0, parentId: null }))).toBe(true);
    expect(issueNeedsRefresh(issue({ id: "child", number: 0, parentId: "parent" }))).toBe(false);
    expect(issueNeedsRefresh(issue({ id: "full", number: 42, parentId: null }))).toBe(false);
  });

  it("does not return a detached placeholder from linear_issue_get", async () => {
    const store = createTestStore();
    store.putTeams([team("team_eng", "ENG")], NOW);
    store.putIssues(
      [issue({ id: "stub", identifier: "ENG-9", number: 0, title: "Placeholder", updatedAt: 0 })],
      NOW,
    );
    const refreshIssue = vi.fn(async () => {
      store.putIssues(
        [
          issue({
            id: "stub",
            identifier: "ENG-9",
            number: 9,
            title: "Hydrated issue",
            description: "Full description",
            url: "https://linear.app/example/issue/ENG-9",
            updatedAt: NOW + 1,
          }),
        ],
        NOW + 1,
      );
      return store.issue("stub");
    });
    const registered: Array<{ name: string; execute: (...args: any[]) => unknown }> = [];
    const bb = {
      agents: {
        registerTool: (tool: { name: string; execute: (...args: any[]) => unknown }) =>
          registered.push(tool),
        configure: () => {},
      },
    };
    registerTools(bb as never, {
      store,
      bindings: () => [
        {
          projectId: "project",
          teamId: "team_eng",
          role: "primary",
          boundAt: NOW,
          origin: "manual",
        },
      ],
      refreshIssue,
    } as never);

    const tool = registered.find((entry) => entry.name === "linear_issue_get");
    const result = await tool?.execute(
      { issue: "ENG-9" },
      { projectId: "project", signal: undefined },
    );

    expect(refreshIssue).toHaveBeenCalledWith("ENG-9", ["team_eng"], undefined);
    expect(result).toContain("Hydrated issue");
    expect(result).toContain("Full description");
  });

  it("adds mirrored resources, relations and parent while activity stays opt-in and bounded", async () => {
    const store = createTestStore();
    store.putTeams([team("team_eng", "ENG")], NOW);
    store.putIssues([
      issue({ id: "parent", identifier: "ENG-1", title: "Parent" }),
      issue({ id: "main", identifier: "ENG-2", title: "Main", parentId: "parent" }),
      issue({ id: "blocker", identifier: "ENG-3", title: "Blocker" }),
    ], NOW);
    store.putMembers([member("u_history", "Pat Assignee")]);
    store.mergeAttachments([{ id: "a1", issueId: "main", title: "PR", subtitle: "#12", url: "https://example.com/pr", sourceType: "github", groupBySource: true, createdAt: NOW, updatedAt: NOW, creatorId: null }]);
    store.replaceDocuments("main", [{ id: "d1", issueId: "main", title: "Spec", url: "https://example.com/spec", updatedAt: NOW, icon: null, color: null }]);
    store.mergeRelations([{ id: "r1", issueId: "blocker", relatedIssueId: "main", type: "blocks" }]);
    store.putHistory(Array.from({ length: 35 }, (_, index) => ({
      id: `h${index}:description`, issueId: "main", createdAt: NOW + index,
      actorId: null,
      botName: null,
      ...(index === 34
        ? { kind: "assignee" as const, payload: { from: null, to: "u_history" } }
        : { kind: "description" as const, payload: {} }),
    })));
    const registered: Array<{ name: string; execute: (...args: any[]) => unknown }> = [];
    registerTools({ agents: { registerTool: (tool: any) => registered.push(tool), configure: () => {} } } as never, {
      store,
      bindings: () => [{ projectId: "project", teamId: "team_eng", role: "primary", boundAt: NOW, origin: "manual" }],
      refreshIssue: vi.fn(),
    } as never);
    const tool = registered.find((entry) => entry.name === "linear_issue_get")!;
    const quiet = await tool.execute({ issue: "ENG-2", include_activity: false }, { projectId: "project" });
    expect(quiet).toContain("Parent: ENG-1 — Parent");
    expect(quiet).toContain("Resources:");
    expect(quiet).toContain("PR — #12 — https://example.com/pr");
    expect(quiet).toContain("blocked by: ENG-3 — Blocker");
    expect(quiet).not.toContain("Activity (");

    const active = await tool.execute({ issue: "ENG-2", include_activity: true }, { projectId: "project" });
    expect(active).toContain("Activity (last 30):");
    expect(active.match(/edited the description/g)).toHaveLength(29);
    expect(active).toContain("Linear: edited the description");
    expect(active).toContain("Linear: assigned to Pat Assignee");
  });
});

describe("pane write agent tools", () => {
  const NEW_TOOLS = [
    "linear_comment_react",
    "linear_comment_edit",
    "linear_issue_set_parent",
  ];

  it("offers the new tools only with full agent writes", () => {
    for (const name of NEW_TOOLS) {
      expect(toolsFor("off")).not.toContain(name);
      expect(toolsFor("comment")).not.toContain(name);
      expect(toolsFor("full")).toContain(name);
    }
  });

  it("registers the new tools and no deletion tool", () => {
    const names: string[] = [];
    registerTools({
      agents: {
        registerTool: (tool: { name: string }) => names.push(tool.name),
        configure: () => {},
      },
    } as never, {} as never);
    expect(names).toEqual(expect.arrayContaining(NEW_TOOLS));
    expect(names.filter((name) => name.includes("delete"))).toEqual([]);
  });

  it("documents every new tool in the shipped Linear skill", () => {
    const skill = readFileSync(
      fileURLToPath(new URL("../skills/linear/SKILL.md", import.meta.url)),
      "utf8",
    );
    for (const name of NEW_TOOLS) expect(skill).toContain(name);
  });
});
