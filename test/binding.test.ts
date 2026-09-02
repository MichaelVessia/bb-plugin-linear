import { describe, expect, it } from "vitest";
import {
  resolveBinding,
  SUGGESTION_THRESHOLD,
  titleSimilarity,
  type LadderDeps,
  type LadderInput,
  type LadderMessage,
} from "../src/binding.js";
import type { IssueRow, ThreadLinkRow } from "../src/store/rows.js";

/**
 * The ladder is pure, so these tests are fixtures and assertions — no store,
 * no host, no clock. Each rung's test also asserts the rung ABOVE it wins,
 * because the ordering is the design.
 */

function issue(overrides: Partial<IssueRow> & { id: string; identifier: string; title: string; teamId: string }): IssueRow {
  return {
    number: 1,
    description: null,
    url: null,
    branchName: null,
    priority: 0,
    estimate: null,
    stateId: null,
    assigneeId: null,
    creatorId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    dueDate: null,
    sortOrder: 0,
    subIssueSortOrder: null,
    labelIds: [],
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    triagedAt: null,
    archivedAt: null,
    createdAt: null,
    updatedAt: 0,
    syncedAt: 0,
    ...overrides,
  } as IssueRow;
}

const M2 = issue({ id: "i2", identifier: "LIN-2", title: "SQLite mirror + webhooks + polling", teamId: "team_lin", branchName: "feature/lin-2-m2-sqlite-mirror" });
const M4 = issue({ id: "i4", identifier: "LIN-4", title: "Left nav panel — list-first Linear browser", teamId: "team_lin" });
const FOREIGN = issue({ id: "ix", identifier: "OPS-9", title: "Rotate the pager", teamId: "team_ops", branchName: "feature/ops-9-rotate" });

function deps(overrides: Partial<LadderDeps> = {}): LadderDeps {
  return {
    threadLink: () => null,
    issuesByBranch: (branch) =>
      [M2, FOREIGN].filter((entry) => entry.branchName === branch),
    issueByIdentifier: (identifier) =>
      [M2, M4, FOREIGN].find((entry) => entry.identifier === identifier) ?? null,
    openIssues: () => [M2, M4],
    readTeamIds: new Set(["team_lin"]),
    ...overrides,
  };
}

function opening(text: string): LadderMessage {
  return { text, label: "the opening user message" };
}

function later(text: string): LadderMessage {
  return { text, label: "a later user message" };
}

function input(overrides: Partial<LadderInput> = {}): LadderInput {
  return { threadId: "th_1", branchName: null, userMessages: [], title: null, ...overrides };
}

describe("rung 1 — an existing link", () => {
  it("wins over everything below and is never re-written", () => {
    const link: ThreadLinkRow = {
      threadId: "th_1",
      issueId: "i4",
      teamId: "team_lin",
      projectId: null,
      createdAt: 1,
      origin: "manual",
    };
    const outcome = resolveBinding(
      deps({ threadLink: () => link }),
      // A branch and a key that would both bind to M2 — the manual link to M4
      // still answers.
      input({
        branchName: "feature/lin-2-m2-sqlite-mirror",
        userMessages: [opening("work on LIN-2")],
      }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i4", teamId: "team_lin", origin: "manual", isNew: false });
  });

  it("keeps its stored provenance", () => {
    const link: ThreadLinkRow = {
      threadId: "th_1",
      issueId: "i2",
      teamId: "team_lin",
      projectId: null,
      createdAt: 1,
      origin: "message",
      provenance: 'the opening user message ("lin-2")',
    };
    const outcome = resolveBinding(deps({ threadLink: () => link }), input());
    expect(outcome).toMatchObject({
      kind: "bound",
      provenance: 'the opening user message ("lin-2")',
    });
  });

  it("never silently switches a message-bound thread — a later key becomes an alternate", () => {
    const link: ThreadLinkRow = {
      threadId: "th_1",
      issueId: "i2",
      teamId: "team_lin",
      projectId: null,
      createdAt: 1,
      origin: "message",
    };
    const outcome = resolveBinding(
      deps({ threadLink: () => link }),
      input({ userMessages: [opening("work on LIN-2"), later("actually see LIN-4 too")] }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2", isNew: false });
    expect(outcome.kind === "bound" ? outcome.alternates : []).toEqual([
      { issueId: "i4", identifier: "LIN-4", title: M4.title },
    ]);
  });

  it("does not second-guess a manual link with alternates", () => {
    const link: ThreadLinkRow = {
      threadId: "th_1",
      issueId: "i2",
      teamId: "team_lin",
      projectId: null,
      createdAt: 1,
      origin: "manual",
    };
    const outcome = resolveBinding(
      deps({ threadLink: () => link }),
      input({ userMessages: [opening("see LIN-4")] }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2", alternates: [] });
  });
});

describe("rung 2 — the branch", () => {
  it("binds deterministically with branch provenance", () => {
    const outcome = resolveBinding(deps(), input({ branchName: "feature/lin-2-m2-sqlite-mirror" }));
    expect(outcome).toMatchObject({
      kind: "bound",
      issueId: "i2",
      teamId: "team_lin",
      origin: "branch",
      isNew: true,
      provenance: "the branch feature/lin-2-m2-sqlite-mirror",
    });
  });

  it("ignores a branch that names another team's issue", () => {
    // Writing to a board this project cannot read is the accident the scope
    // rules exist to prevent — the branch fact is real, the binding is not.
    const outcome = resolveBinding(deps(), input({ branchName: "feature/ops-9-rotate" }));
    expect(outcome.kind).toBe("none");
  });
});

describe("rung 2.5 — an identifier retained in a hand-edited branch", () => {
  it("binds when the branch no longer exactly matches Linear's stored branch name", () => {
    const outcome = resolveBinding(deps(), input({ branchName: "work/lin-2-custom-name" }));
    expect(outcome).toMatchObject({
      kind: "bound",
      issueId: "i2",
      teamId: "team_lin",
      origin: "branch",
      isNew: true,
      provenance: "the branch work/lin-2-custom-name (LIN-2)",
    });
  });

  it("respects read scope", () => {
    const outcome = resolveBinding(deps(), input({ branchName: "work/ops-9-custom-name" }));
    expect(outcome.kind).toBe("none");
  });

  it("loses to Linear's exact stored branch-name match", () => {
    const outcome = resolveBinding(
      deps({ issueByIdentifier: () => M4 }),
      input({ branchName: "feature/lin-2-m2-sqlite-mirror" }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2", origin: "branch" });
  });

  it("does not rebind an identifier the thread declined", () => {
    const outcome = resolveBinding(
      deps({ issueByIdentifier: () => null }),
      input({ branchName: "work/lin-2-custom-name" }),
    );
    expect(outcome.kind).toBe("none");
  });
});

describe("rung 3 — a key in a USER message", () => {
  it("binds the first resolvable identifier from the opening message, with provenance", () => {
    const outcome = resolveBinding(
      deps(),
      input({ userMessages: [opening("please pick up LIN-4 after LIN-2")] }),
    );
    expect(outcome).toMatchObject({
      kind: "bound",
      issueId: "i4",
      teamId: "team_lin",
      origin: "message",
      isNew: true,
      provenance: 'the opening user message ("LIN-4")',
    });
  });

  it("matches keys case-insensitively and normalises to uppercase", () => {
    const outcome = resolveBinding(
      deps(),
      input({ userMessages: [opening("continue lin-2 please")] }),
    );
    expect(outcome).toMatchObject({
      kind: "bound",
      issueId: "i2",
      origin: "message",
      provenance: 'the opening user message ("LIN-2")',
    });
  });

  it("exposes every other user-named key as an alternate", () => {
    const outcome = resolveBinding(
      deps(),
      input({ userMessages: [opening("start with LIN-2"), later("related: LIN-4")] }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2" });
    expect(outcome.kind === "bound" ? outcome.alternates : []).toEqual([
      { issueId: "i4", identifier: "LIN-4", title: M4.title },
    ]);
  });

  it("skips keys that resolve out of scope and keys that resolve to nothing", () => {
    const outcome = resolveBinding(
      deps(),
      input({ userMessages: [opening("OPS-9 then NOPE-1 then LIN-2")] }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2", teamId: "team_lin", origin: "message", isNew: true });
  });

  it("loses to the branch", () => {
    const outcome = resolveBinding(
      deps(),
      input({ branchName: "feature/lin-2-m2-sqlite-mirror", userMessages: [opening("LIN-4")] }),
    );
    expect(outcome).toMatchObject({ origin: "branch", issueId: "i2" });
    // The user-named issue still surfaces, as an alternate.
    expect(outcome.kind === "bound" ? outcome.alternates : []).toEqual([
      { issueId: "i4", identifier: "LIN-4", title: M4.title },
    ]);
  });
});

describe("rung 3.5 — a key in the title never binds", () => {
  it("suggests instead, because a bb title's authorship is unknowable", () => {
    // The regression this guards: assistant output mentioned an old, related
    // issue; only user messages may bind. A title (or any non-user text) with
    // a key must come back as a suggestion the user confirms.
    const outcome = resolveBinding(deps(), input({ title: "Fix LIN-4 nav panel" }));
    expect(outcome).toMatchObject({ kind: "suggestion", issueId: "i4", identifier: "LIN-4" });
  });

  it("loses to a key in a user message", () => {
    const outcome = resolveBinding(
      deps(),
      input({ title: "Fix LIN-4 nav panel", userMessages: [opening("work on lin-2")] }),
    );
    expect(outcome).toMatchObject({ kind: "bound", issueId: "i2", origin: "message" });
  });

  it("respects read scope", () => {
    const outcome = resolveBinding(deps(), input({ title: "Rotate OPS-9 pager" }));
    expect(outcome.kind).toBe("none");
  });
});

describe("rung 4 — fuzzy, suggestion only", () => {
  it("suggests, never binds", () => {
    const outcome = resolveBinding(
      deps(),
      input({ title: "SQLite mirror webhooks polling work" }),
    );
    expect(outcome).toMatchObject({ kind: "suggestion", identifier: "LIN-2" });
  });

  it("stays quiet when the best match is ambiguous against the runner-up", () => {
    const twins = [
      issue({ id: "a", identifier: "LIN-20", title: "Webhook delivery retries", teamId: "team_lin" }),
      issue({ id: "b", identifier: "LIN-21", title: "Webhook delivery logging", teamId: "team_lin" }),
    ];
    const outcome = resolveBinding(
      deps({ openIssues: () => twins }),
      input({ title: "Webhook delivery" }),
    );
    expect(outcome.kind).toBe("none");
  });

  it("stays quiet on a one-word title", () => {
    const outcome = resolveBinding(deps(), input({ title: "Linear" }));
    expect(outcome.kind).toBe("none");
  });

  it("stays quiet below the threshold", () => {
    const outcome = resolveBinding(deps(), input({ title: "Completely unrelated grocery list" }));
    expect(outcome.kind).toBe("none");
  });
});

describe("titleSimilarity", () => {
  it("scores real pairs above the threshold and noise below it", () => {
    expect(
      titleSimilarity("Fix the webhook health check", "Webhook health check demotes to polling"),
    ).toBeGreaterThan(SUGGESTION_THRESHOLD);
    expect(titleSimilarity("Grocery list", "Webhook health check demotes to polling")).toBe(0);
  });

  it("ignores stopwords and case", () => {
    expect(titleSimilarity("BUILD the Mirror", "mirror")).toBe(titleSimilarity("Mirror", "mirror"));
  });
});
