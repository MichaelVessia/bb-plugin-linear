import { describe, expect, it, vi } from "vitest";
import { issueNeedsRefresh, registerTools } from "../src/tools.js";
import { createTestStore, issue, NOW, team } from "./helpers/store.js";

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
});
