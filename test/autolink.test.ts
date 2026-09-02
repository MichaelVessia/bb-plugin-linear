import { describe, expect, it } from "vitest";
import { inferProjectLink, type AutolinkInput } from "../src/autolink.js";
import { SETTING_DESCRIPTORS } from "../src/settings.js";

const TEAMS = [
  { id: "team_abc", key: "ABC", name: "Payments API" },
  { id: "team_des", key: "DES", name: "Design System" },
  { id: "team_mob", key: "MOB", name: "Mobile API" },
  { id: "team_ops", key: "OPS", name: "Operations" },
];

function input(overrides: Partial<AutolinkInput> = {}): AutolinkInput {
  return {
    existingBindings: [],
    declined: false,
    teams: TEAMS,
    evidence: [],
    repoName: "payments api",
    autoBindEnabled: true,
    ...overrides,
  };
}

describe("project auto-link inference", () => {
  it("ships the automatic-binding evidence gate on by default", () => {
    expect(SETTING_DESCRIPTORS.autoBind.type).toBe("boolean");
    expect(SETTING_DESCRIPTORS.autoBind.default).toBe(true);
    expect(SETTING_DESCRIPTORS.autoBind.description).toContain("exactly one team");
    expect(SETTING_DESCRIPTORS.autoBind.description).toContain("undo");
  });

  it("binds single-team identifier evidence and names its strongest source", () => {
    expect(
      inferProjectLink(
        input({
          evidence: [
            { identifier: "veki/abc-123-fix", teamKey: "abc", source: "branch" },
          ],
        }),
      ),
    ).toEqual({
      kind: "bind",
      teamId: "team_abc",
      reason: "branch veki/abc-123-fix names ABC",
    });
  });

  it("offers single-team identifier evidence when automatic binding is off", () => {
    expect(
      inferProjectLink(
        input({
          autoBindEnabled: false,
          evidence: [{ identifier: "ABC-123", teamKey: "ABC", source: "title" }],
        }),
      ),
    ).toEqual({
      kind: "offer",
      teams: [{ teamId: "team_abc", reason: "title ABC-123 names ABC" }],
    });
  });

  it("offers conflicting evidence with branch counts ahead of title counts", () => {
    const decision = inferProjectLink(
      input({
        evidence: [
          { identifier: "DES-1", teamKey: "DES", source: "title" },
          { identifier: "DES-2", teamKey: "DES", source: "title" },
          { identifier: "work/ops-9", teamKey: "OPS", source: "branch" },
        ],
      }),
    );
    expect(decision.kind).toBe("offer");
    if (decision.kind !== "offer") return;
    expect(decision.teams.map((entry) => entry.teamId)).toEqual(["team_ops", "team_des"]);
  });

  it("offers rather than guessing when two accessible workspaces share a team key", () => {
    const decision = inferProjectLink(
      input({
        teams: [
          { id: "personal_eng", key: "ENG", name: "Personal Engineering" },
          { id: "company_eng", key: "ENG", name: "Company Engineering" },
        ],
        evidence: [{ identifier: "ENG-42", teamKey: "ENG", source: "title" }],
      }),
    );
    expect(decision.kind).toBe("offer");
    if (decision.kind !== "offer") return;
    expect(decision.teams.map((entry) => entry.teamId).sort()).toEqual([
      "company_eng",
      "personal_eng",
    ]);
  });

  it("offers the only accessible team when there is no identifier evidence", () => {
    expect(inferProjectLink(input({ teams: [TEAMS[0]!] }))).toEqual({
      kind: "offer",
      teams: [{ teamId: "team_abc", reason: "the only team you can see" }],
    });
  });

  it("caps and ranks many no-evidence offers by repository-name similarity", () => {
    const decision = inferProjectLink(input());
    expect(decision.kind).toBe("offer");
    if (decision.kind !== "offer") return;
    expect(decision.teams.map((entry) => entry.teamId)).toEqual([
      "team_abc",
      "team_mob",
      "team_des",
    ]);
  });

  it("orders no-evidence offers by team name when the repository name is unavailable", () => {
    const decision = inferProjectLink(input({ repoName: null }));
    expect(decision.kind).toBe("offer");
    if (decision.kind !== "offer") return;
    expect(decision.teams.map((entry) => entry.teamId)).toEqual([
      "team_des",
      "team_mob",
      "team_ops",
    ]);
  });

  it("returns none after the project declined automatic binding", () => {
    expect(inferProjectLink(input({ declined: true }))).toEqual({ kind: "none" });
  });

  it("returns none when any project binding already exists", () => {
    expect(inferProjectLink(input({ existingBindings: [{ teamId: "team_des" }] }))).toEqual({
      kind: "none",
    });
  });

  it("never binds from name similarity alone", () => {
    expect(inferProjectLink(input()).kind).toBe("offer");
  });
});
