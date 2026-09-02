import type { WorkflowStateRow } from "../store/rows.js";

/** Linear's status-pie circumference, deliberately 97% of 2πr. */
export const ISSUE_PIE_DASH = 12.189379495928398;
export const ISSUE_PIE_GAP = 24.378758991856795;
export const ISSUE_DISC_DASH = 18.84955592153876;
export const ISSUE_DISC_GAP = 37.69911184307752;
export const SUB_ISSUE_CIRCUMFERENCE = 43.982297150257104;

export interface GlyphSpec {
  readonly ring: "solid" | "dashed";
  readonly pie: number | null;
  readonly disc: boolean;
  readonly mark: "check" | "x" | "dot" | null;
  readonly color: string | null;
}

export interface ProjectGlyphSpec {
  readonly type: string;
  readonly color: string | null;
  readonly progress: number;
}

export function projectGlyphSpec(input: {
  readonly type: string;
  readonly color: string | null;
  readonly progress: number | null;
}): ProjectGlyphSpec {
  return {
    type: input.type,
    color: input.color,
    progress: Math.min(Math.max(input.progress ?? 0, 0), 1),
  };
}

/**
 * Linear starts every started state at one half, then divides the remaining
 * half across the team's started states in position order. The last state is
 * deliberately short of one: completion has its own full-disc vocabulary.
 */
export function startedFraction(index: number, count: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(count) || count <= 0) return 0.5;
  const safeIndex = Math.min(Math.max(Math.floor(index), 0), Math.max(Math.floor(count) - 1, 0));
  return 0.5 + 0.5 * (safeIndex / Math.floor(count));
}

/** Exact dash offset for Linear's sub-issue progress ring. */
export function subIssueArc(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) {
    return SUB_ISSUE_CIRCUMFERENCE;
  }
  const fraction = Math.min(Math.max(done / total, 0), 1);
  return SUB_ISSUE_CIRCUMFERENCE * (1 - fraction);
}

export function glyphSpec(input: {
  readonly type: string;
  readonly color: string | null;
  readonly startedIndex: number | null;
  readonly startedCount: number | null;
}): GlyphSpec {
  const base = { color: input.color };
  switch (input.type) {
    case "backlog":
      return { ...base, ring: "dashed", pie: 0, disc: false, mark: null };
    case "unstarted":
      return { ...base, ring: "solid", pie: 0, disc: false, mark: null };
    case "started":
      return {
        ...base,
        ring: "solid",
        pie: startedFraction(input.startedIndex ?? 0, input.startedCount ?? 1),
        disc: false,
        mark: null,
      };
    case "completed":
      return { ...base, ring: "solid", pie: null, disc: true, mark: "check" };
    case "canceled":
    case "duplicate":
      return { ...base, ring: "solid", pie: null, disc: true, mark: "x" };
    case "triage":
      return { ...base, ring: "solid", pie: null, disc: false, mark: "dot" };
    default:
      return { ...base, ring: "solid", pie: null, disc: false, mark: null };
  }
}

/**
 * Compute every state once per team. `workflowStates` is already position
 * ordered, but sorting here keeps this pure projection correct for tests and
 * for any caller assembling rows from more than one team.
 */
export function glyphsForStates(states: readonly WorkflowStateRow[]): ReadonlyMap<string, GlyphSpec> {
  const byTeam = new Map<string, WorkflowStateRow[]>();
  for (const state of states) {
    byTeam.set(state.teamId, [...(byTeam.get(state.teamId) ?? []), state]);
  }

  const result = new Map<string, GlyphSpec>();
  for (const teamStates of byTeam.values()) {
    const ordered = [...teamStates].sort((a, b) => a.position - b.position);
    const started = ordered.filter((state) => state.type === "started");
    const startedIndexes = new Map(started.map((state, index) => [state.id, index]));
    for (const state of ordered) {
      result.set(
        state.id,
        glyphSpec({
          type: state.type,
          color: state.color,
          startedIndex: startedIndexes.get(state.id) ?? null,
          startedCount: state.type === "started" ? started.length : null,
        }),
      );
    }
  }
  return result;
}

export const COMPLETED_GLYPH_SPEC: GlyphSpec = glyphSpec({
  type: "completed",
  color: null,
  startedIndex: null,
  startedCount: null,
});
