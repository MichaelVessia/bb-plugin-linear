import { titleSimilarity } from "./binding.js";

export interface AutolinkTeam {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface IdentifierEvidence {
  /** The source text that carried the identifier. For branches this is the
   *  branch name; for titles/messages it is the resolved issue identifier. */
  readonly identifier: string;
  readonly teamKey: string;
  readonly source: "branch" | "title";
}

export interface AutolinkInput {
  /** Only bindings for the project being evaluated. Any row means the user
   *  already has an explicit scope and inference has nothing to do. */
  readonly existingBindings: readonly unknown[];
  readonly declined: boolean;
  readonly teams: readonly AutolinkTeam[];
  readonly evidence: readonly IdentifierEvidence[];
  readonly repoName: string | null;
  readonly autoBindEnabled: boolean;
}

export type AutolinkDecision =
  | { readonly kind: "bind"; readonly teamId: string; readonly reason: string }
  | {
      readonly kind: "offer";
      readonly teams: readonly { readonly teamId: string; readonly reason: string }[];
    }
  | { readonly kind: "none" };

interface EvidenceMatch {
  readonly team: AutolinkTeam;
  readonly evidence: readonly IdentifierEvidence[];
}

/**
 * Infer a project-to-team binding from explicit identifiers, or rank offers.
 *
 * Identifier evidence may bind because a person already chose a team key in
 * another surface. Names are useful only for ordering offers; they never bind.
 */
export function inferProjectLink(input: AutolinkInput): AutolinkDecision {
  if (input.existingBindings.length > 0 || input.declined) return { kind: "none" };

  const teamsByKey = new Map<string, AutolinkTeam[]>();
  for (const team of input.teams) {
    const key = team.key.toUpperCase();
    const rows = teamsByKey.get(key) ?? [];
    rows.push(team);
    teamsByKey.set(key, rows);
  }

  const evidenceByTeam = new Map<string, IdentifierEvidence[]>();
  for (const evidence of input.evidence) {
    for (const team of teamsByKey.get(evidence.teamKey.toUpperCase()) ?? []) {
      const rows = evidenceByTeam.get(team.id) ?? [];
      rows.push(evidence);
      evidenceByTeam.set(team.id, rows);
    }
  }

  const matches: EvidenceMatch[] = input.teams
    .filter((team) => evidenceByTeam.has(team.id))
    .map((team) => ({ team, evidence: evidenceByTeam.get(team.id)! }));

  if (matches.length === 1) {
    const match = matches[0]!;
    const reason = evidenceReason(match.team, match.evidence);
    return input.autoBindEnabled
      ? { kind: "bind", teamId: match.team.id, reason }
      : { kind: "offer", teams: [{ teamId: match.team.id, reason }] };
  }

  if (matches.length > 1) {
    return {
      kind: "offer",
      teams: [...matches]
        .sort((left, right) => compareEvidenceMatches(left, right, input.repoName))
        .map((match) => ({
          teamId: match.team.id,
          reason: evidenceReason(match.team, match.evidence),
        })),
    };
  }

  if (input.teams.length === 0) return { kind: "none" };
  if (input.teams.length === 1) {
    return {
      kind: "offer",
      teams: [{ teamId: input.teams[0]!.id, reason: "the only team you can see" }],
    };
  }

  const ranked = [...input.teams]
    .sort((left, right) => compareByRepoName(left, right, input.repoName))
    .slice(0, 3);
  return {
    kind: "offer",
    teams: ranked.map((team) => ({
      teamId: team.id,
      reason:
        input.repoName !== null && titleSimilarity(input.repoName, team.name) > 0
          ? "name resembles the repo"
          : "available team",
    })),
  };
}

function evidenceReason(team: AutolinkTeam, evidence: readonly IdentifierEvidence[]): string {
  const strongest = evidence.find((entry) => entry.source === "branch") ?? evidence[0]!;
  return `${strongest.source} ${strongest.identifier} names ${team.key}`;
}

function compareEvidenceMatches(
  left: EvidenceMatch,
  right: EvidenceMatch,
  repoName: string | null,
): number {
  const leftBranches = left.evidence.filter((entry) => entry.source === "branch").length;
  const rightBranches = right.evidence.filter((entry) => entry.source === "branch").length;
  if (leftBranches !== rightBranches) return rightBranches - leftBranches;

  const leftTitles = left.evidence.length - leftBranches;
  const rightTitles = right.evidence.length - rightBranches;
  if (leftTitles !== rightTitles) return rightTitles - leftTitles;

  return compareByRepoName(left.team, right.team, repoName);
}

function compareByRepoName(
  left: AutolinkTeam,
  right: AutolinkTeam,
  repoName: string | null,
): number {
  if (repoName !== null) {
    const score =
      titleSimilarity(repoName, right.name) - titleSimilarity(repoName, left.name);
    if (score !== 0) return score;
  }
  return left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
}
