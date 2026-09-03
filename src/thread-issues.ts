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
}

/** The most thread ids one call answers; the rest are simply absent. */
export const THREAD_ISSUES_MAX = 200;

export function threadIssuesFor(input: {
  readonly threadIds: readonly string[];
  readonly store: Pick<Store, "threadLinksByThreadIds" | "issue" | "workflowStates">;
  readonly suggestions: ReadonlyMap<string, ThreadIssueSuggestion>;
}): Record<string, ThreadIssueEntry> {
  const ids = [...new Set(input.threadIds)].slice(0, THREAD_ISSUES_MAX);
  const links = new Map(
    input.store.threadLinksByThreadIds(ids).map((link) => [link.threadId, link]),
  );
  // Workflow states are per team and a sidebar's threads cluster on a few
  // teams, so one read per team rather than one per thread.
  const statesByTeam = new Map<
    string,
    { states: WorkflowStateRow[]; glyphs: ReadonlyMap<string, GlyphSpec> }
  >();
  const statesFor = (teamId: string) => {
    const cached = statesByTeam.get(teamId);
    if (cached !== undefined) return cached;
    const states = input.store.workflowStates(teamId);
    const entry = { states, glyphs: glyphsForStates(states) };
    statesByTeam.set(teamId, entry);
    return entry;
  };

  const result: Record<string, ThreadIssueEntry> = {};
  for (const threadId of ids) {
    const link = links.get(threadId);
    const issue = link === undefined ? null : input.store.issue(link.issueId);
    if (link === undefined || issue === null) {
      result[threadId] = {
        binding: null,
        suggestion: input.suggestions.get(threadId) ?? null,
      };
      continue;
    }
    const { states, glyphs } = statesFor(issue.teamId);
    const state = states.find((entry) => entry.id === issue.stateId) ?? null;
    result[threadId] = {
      binding: {
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        stateName: state?.name ?? "Unknown state",
        tone: toneForStateType(state?.type),
        glyph:
          (state === null ? undefined : glyphs.get(state.id)) ??
          glyphSpec({
            type: state?.type ?? "",
            color: state?.color ?? null,
            startedIndex: null,
            startedCount: null,
          }),
        url: issue.url,
        origin: link.origin,
        provenance: link.provenance ?? null,
      },
      // Never a suggestion while bound: the chip's rule, kept here too.
      suggestion: null,
    };
  }
  return result;
}
