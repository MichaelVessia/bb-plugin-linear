import { toneForStateType, type Tone } from "./select/tone.js";
import type { Store } from "./store/store.js";
import { glyphSpec, glyphsForStates, type GlyphSpec } from "./select/glyph.js";

export type PaneRelationType = "blocks" | "blockedBy" | "related" | "duplicateOf";

/** Linear stores direction in the two ids, not in inverse enum members. */
export function relationCreateInput(input: {
  issueId: string;
  relatedIssueId: string;
  type: PaneRelationType;
}): { issueId: string; relatedIssueId: string; type: "blocks" | "related" | "duplicate" } {
  if (input.type === "blockedBy") {
    return {
      issueId: input.relatedIssueId,
      relatedIssueId: input.issueId,
      type: "blocks",
    };
  }
  return {
    issueId: input.issueId,
    relatedIssueId: input.relatedIssueId,
    type: input.type === "duplicateOf" ? "duplicate" : input.type,
  };
}

export interface PickerIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly tone: Tone;
  readonly glyph: GlyphSpec;
}

/** A bounded mirror-only issue picker. The caller establishes team scope. */
export function searchIssuesForPicker(
  store: Store,
  teamId: string,
  query: string,
): PickerIssue[] {
  const glyphs = glyphsForStates(store.workflowStates(teamId));
  return store
    .queryIssues({
      teamIds: [teamId],
      text: query,
      includeCompleted: true,
      sort: "updated",
      limit: 20,
    })
    .map((issue) => {
      const state = issue.stateId === null ? null : store.workflowState(issue.stateId);
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        tone: toneForStateType(state?.type),
        glyph:
          (state === null ? undefined : glyphs.get(state.id)) ??
          glyphSpec({
            type: state?.type ?? "",
            color: state?.color ?? null,
            startedIndex: null,
            startedCount: null,
          }),
      };
    });
}

export interface MentionCandidate {
  readonly id: string;
  readonly displayName: string;
  readonly handle: string;
}

/** Mention autocomplete uses the mirrored team graph and never opens a
 * socket on the keystroke path. */
export function mentionCandidates(
  store: Store,
  teamId: string,
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLocaleLowerCase();
  return store
    .assignableMembers([teamId])
    .filter((member) => {
      if (needle === "") return true;
      return (
        member.displayName.toLocaleLowerCase().includes(needle) ||
        member.name.toLocaleLowerCase().includes(needle)
      );
    })
    .slice(0, 10)
    .map((member) => ({
      id: member.id,
      displayName: member.displayName,
      handle: member.name,
    }));
}
