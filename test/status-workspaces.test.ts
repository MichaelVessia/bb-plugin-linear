import { describe, expect, it } from "vitest";
import {
  renderStatus,
  type StatusReport,
  type WorkspaceStatusLine,
} from "../src/select/status.js";
import type { ConnectionState } from "../src/contract.js";

/**
 * The mismatch this file guards: `doctor` said "2 keys set, one per
 * workspace" while `status` showed one workspace, and a session spent an
 * hour deciding which one was lying. Every configured slot now renders a
 * line, and the cache count says whose cache it is.
 */

const NOW = 1_700_000_000_000;

const CONNECTED: ConnectionState = {
  kind: "connected",
  viewer: { id: "u1", name: "vedran", displayName: "Vedran", avatarUrl: null },
  workspace: { id: "ws1", name: "Caffeinated Code", urlKey: "caffeinatedcode" },
  budget: null,
  writeRefusal: null,
  checkedAt: NOW,
};

const CAFFEINATED: WorkspaceStatusLine = {
  label: "Linear API key",
  name: "Caffeinated Code",
  urlKey: "caffeinatedcode",
  viewerName: "Vedran",
  keyState: "ok",
  teams: 3,
  issuesCached: 78,
  projectsCached: 2,
  bindings: [],
};

const INDEXED: WorkspaceStatusLine = {
  label: "Linear API key 2",
  name: "Indexed Labs",
  urlKey: "indexed",
  viewerName: "Vedran",
  keyState: "ok",
  teams: 5,
  issuesCached: 700,
  projectsCached: 4,
  bindings: ["indexed → OTTO"],
};

function report(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    connection: CONNECTED,
    now: NOW,
    teamsVisible: 8,
    bindings: [{ projectName: "indexed", primaryTeamKey: "OTTO", extra: [] }],
    unboundProjects: 0,
    sync: {
      profile: "balanced",
      intervalMs: 60_000,
      lastTickAt: NOW - 5_000,
      issues: 778,
      projects: 6,
      lastError: null,
    },
    webhook: null,
    writeRefusal: null,
    workspaces: [CAFFEINATED, INDEXED],
    ...overrides,
  };
}

describe("renderStatus with several workspaces", () => {
  it("lists every configured workspace, not just the first connected one", () => {
    const text = renderStatus(report());
    expect(text).toContain("Caffeinated Code (caffeinatedcode)");
    expect(text).toContain("Indexed Labs (indexed)");
  });

  it("names each workspace's key slot and team count", () => {
    const text = renderStatus(report());
    expect(text).toContain("key ok (Linear API key)");
    expect(text).toContain("key ok (Linear API key 2)");
    expect(text).toContain("3 teams");
    expect(text).toContain("5 teams");
  });

  it("says which bindings belong to which workspace", () => {
    const text = renderStatus(report());
    expect(text).toContain("indexed → OTTO");
  });

  it("agrees with doctor about how many keys are set", () => {
    // "2 keys set, one per workspace" from doctor beside a single-workspace
    // status is the exact confusion this line exists to end.
    expect(renderStatus(report())).toContain("2 keys set, one per workspace");
  });

  it("splits the cached issue count per workspace", () => {
    const text = renderStatus(report());
    expect(text).toContain("778 issues (Caffeinated Code: 78, Indexed Labs: 700)");
  });

  it("renders a set-but-unread key as its own line with the fix", () => {
    const unread: WorkspaceStatusLine = {
      label: "Linear API key 2",
      name: null,
      urlKey: null,
      viewerName: null,
      keyState: "set · workspace not read yet (checking) — bb linear refresh reads it",
      teams: null,
      issuesCached: 0,
      projectsCached: 0,
      bindings: [],
    };
    const text = renderStatus(report({ workspaces: [CAFFEINATED, unread] }));
    expect(text).toContain("Linear API key 2: set · workspace not read yet");
    expect(text).toContain("bb linear refresh");
  });

  it("keeps the single-workspace shape unsplit", () => {
    const text = renderStatus(
      report({
        workspaces: [CAFFEINATED],
        sync: {
          profile: "balanced",
          intervalMs: 60_000,
          lastTickAt: NOW - 5_000,
          issues: 78,
          projects: 2,
          lastError: null,
        },
      }),
    );
    expect(text).toContain("78 issues, 2 projects cached");
    expect(text).not.toContain("keys set");
  });

  it("renders exactly as before when the report has no workspace lines", () => {
    const text = renderStatus(report({ workspaces: null }));
    expect(text).toContain("Caffeinated Code (caffeinatedcode)");
    expect(text).toContain("Vedran");
    expect(text).toContain("778 issues, 6 projects cached");
  });
});
