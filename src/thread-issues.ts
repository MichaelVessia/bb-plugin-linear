/**
 * The batch answer another plugin paints from: which issue each of many
 * threads is bound to, in one read of the mirror.
 *
 * `threadIssue` answers for ONE thread and does more — it kicks an
 * evaluation for an unbound thread so a freshly mounted chip converges.
 * A sidebar asking about two hundred threads must not start two hundred
 * evaluations, so this reads what the mirror already knows and nothing
 * else: bound rows come back with their state and glyph, unbound rows come
 * back with whatever suggestion is already in memory, and nothing waits on
 * Linear.
 *
 * Pure over the store so it is testable against a real in-memory SQLite.
 */
import { glyphSpec, glyphsForStates, type GlyphSpec } from "./select/glyph.js";
import { toneForStateType, type Tone } from "./select/tone.js";
import type { ThreadLinkOrigin, WorkflowStateRow } from "./store/rows.js";
import type { Store } from "./store/store.js";

export interface ThreadIssueSuggestion {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
}

export interface ThreadIssueBinding {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly stateName: string;
  readonly tone: Tone;
  readonly glyph: GlyphSpec;
  readonly url: string | null;
  readonly origin: ThreadLinkOrigin;
  readonly provenance: string | null;
}

export interface ThreadIssueEntry {
  readonly binding: ThreadIssueBinding | null;
  readonly suggestion: ThreadIssueSuggestion | null;
  readonly active: ThreadIssueBinding[];
  readonly activeCount: number;
}

/** The most thread ids one call answers; the rest are simply absent. */
export const THREAD_ISSUES_MAX = 200;

export function threadIssuesFor(input: {
  readonly threadIds: readonly string[];
  readonly store: Pick<Store, "threadLinksByThreadIds" | "threadWorkByThreadIds" | "issue" | "workflowStates">;
  readonly suggestions: ReadonlyMap<string, ThreadIssueSuggestion>;
}): Record<string, ThreadIssueEntry> {
  const ids = [...new Set(input.threadIds)].slice(0, THREAD_ISSUES_MAX);
  const links = new Map(
    input.store.threadLinksByThreadIds(ids).map((link) => [link.threadId, link]),
  );
  const project = createWorkProjector(input.store);
  const workByThread = new Map<string, import("./store/thread-work.js").WorkRow[]>();
  for (const row of input.store.threadWorkByThreadIds(ids)) {
    const entries = workByThread.get(row.threadId) ?? [];
    entries.push(row);
    workByThread.set(row.threadId, entries);
  }
  const result: Record<string, ThreadIssueEntry> = {};
  for (const threadId of ids) {
    const activeRows = workByThread.get(threadId) ?? [];
    const active = activeRows.flatMap((row) => {
      const binding = project(row);
      return binding === null ? [] : [binding];
    });
    const link = links.get(threadId);
    const binding = link === undefined ? null : project(link);
    result[threadId] = { binding, active, activeCount: activeRows.length,
      suggestion: binding === null ? input.suggestions.get(threadId) ?? null : null };
  }
  return result;
}

/** Shared projection for active issues and previous work. Missing mirror rows
 * remain in storage, so reconnecting a workspace restores their details. */
export function threadWorkBinding(
  store: Pick<Store, "issue" | "workflowStates">,
  link: import("./store/rows.js").ThreadLinkRow,
): ThreadIssueBinding | null {
  return createWorkProjector(store)(link);
}

/** Cache issue and team reads within each projection, including large sidebar batches. */
export function createWorkProjector(store: Pick<Store, "issue" | "workflowStates">) {
  const issues = new Map<string, ReturnType<Store["issue"]>>();
  const teams = new Map<string, { states: WorkflowStateRow[]; glyphs: ReadonlyMap<string, GlyphSpec> }>();
  return (link: import("./store/rows.js").ThreadLinkRow): ThreadIssueBinding | null => {
    if (!issues.has(link.issueId)) issues.set(link.issueId, store.issue(link.issueId));
    const issue = issues.get(link.issueId);
    if (!issue) return null;
    let team = teams.get(issue.teamId);
    if (!team) {
      const states = store.workflowStates(issue.teamId);
      team = { states, glyphs: glyphsForStates(states) };
      teams.set(issue.teamId, team);
    }
    const state = team.states.find((entry) => entry.id === issue.stateId) ?? null;
    return {
      issueId: issue.id, identifier: issue.identifier, title: issue.title,
      stateName: state?.name ?? "Unknown state", tone: toneForStateType(state?.type),
      glyph: (state === null ? undefined : team.glyphs.get(state.id)) ??
        glyphSpec({ type: state?.type ?? "", color: state?.color ?? null, startedIndex: null, startedCount: null }),
      url: issue.url, origin: link.origin, provenance: link.provenance ?? null,
    };
  };
}
