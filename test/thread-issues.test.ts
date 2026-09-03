import { describe, expect, it } from "vitest";
import { THREAD_ISSUES_MAX, threadIssuesFor } from "../src/thread-issues.js";
import { createTestStore, issue, NOW, state, team } from "./helpers/store.js";

function seeded() {
  const store = createTestStore();
  store.putTeams([team("team_eng", "ENG")], NOW);
  store.replaceWorkflowStates("team_eng", [
    state("s_todo", "team_eng", "unstarted", 0, "Todo"),
    state("s_doing", "team_eng", "started", 1, "In Progress"),
  ]);
  store.putIssues(
    [
      issue({ id: "i1", identifier: "ENG-1", title: "First", stateId: "s_doing", url: "https://linear.app/acme/issue/ENG-1" }),
      issue({ id: "i2", identifier: "ENG-2", title: "Second", stateId: "s_todo" }),
    ],
    NOW,
  );
  store.linkThread({ threadId: "th_1", issueId: "i1", teamId: "team_eng", projectId: "proj", createdAt: NOW, origin: "message", provenance: 'the opening user message ("ENG-1")' });
  store.linkThread({ threadId: "th_2", issueId: "i2", teamId: "team_eng", projectId: "proj", createdAt: NOW, origin: "manual" });
  return store;
}

describe("threadIssuesFor", () => {
  it("answers bound threads with state, glyph and provenance, unbound with their suggestion", () => {
    const store = seeded();
    const suggestions = new Map([
      ["th_free", { issueId: "i2", identifier: "ENG-2", title: "Second" }],
    ]);
    const result = threadIssuesFor({ threadIds: ["th_1", "th_2", "th_free", "th_none"], store, suggestions });

    expect(result.th_1?.binding).toMatchObject({
      issueId: "i1",
      identifier: "ENG-1",
      title: "First",
      stateName: "In Progress",
      tone: "started",
      url: "https://linear.app/acme/issue/ENG-1",
      origin: "message",
      provenance: 'the opening user message ("ENG-1")',
    });
    expect(result.th_1?.binding?.glyph).toMatchObject({ ring: "solid" });
    expect(result.th_1?.suggestion).toBeNull();
    expect(result.th_2?.binding).toMatchObject({ identifier: "ENG-2", stateName: "Todo", tone: "unstarted", provenance: null });
    expect(result.th_free).toEqual({ binding: null, suggestion: { issueId: "i2", identifier: "ENG-2", title: "Second" } });
    expect(result.th_none).toEqual({ binding: null, suggestion: null });
  });

  it("falls back to an unknown state when the issue's state is not mirrored", () => {
    const store = seeded();
    store.putIssues([issue({ id: "i3", identifier: "ENG-3", title: "Orphan", stateId: "s_gone" })], NOW);
    store.linkThread({ threadId: "th_3", issueId: "i3", teamId: "team_eng", projectId: null, createdAt: NOW, origin: "branch" });
    const result = threadIssuesFor({ threadIds: ["th_3"], store, suggestions: new Map() });
    expect(result.th_3?.binding).toMatchObject({ stateName: "Unknown state", tone: "unknown" });
  });

  it("caps the answer and drops duplicates rather than failing", () => {
    const store = seeded();
    const ids = Array.from({ length: THREAD_ISSUES_MAX + 5 }, (_, i) => `th_${i}`);
    const result = threadIssuesFor({ threadIds: [...ids, "th_0"], store, suggestions: new Map() });
    expect(Object.keys(result)).toHaveLength(THREAD_ISSUES_MAX);
  });
});
