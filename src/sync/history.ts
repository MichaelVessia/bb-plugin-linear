import type { IssueHistoryNode } from "../linear/types.js";
import type { HistoryKind } from "../store/rows.js";

export interface NormalizedHistoryEvent {
  readonly kind: HistoryKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Convert one polymorphic Linear history record into stable, independently
 * renderable events. A single record may describe several changes; splitting
 * here lets the projection remain a vocabulary/phrasing concern rather than a
 * second interpreter for Linear's transport shape.
 */
export function normalizeHistory(
  node: IssueHistoryNode,
): readonly NormalizedHistoryEvent[] | null {
  const events: NormalizedHistoryEvent[] = [];
  const transition = (
    kind: HistoryKind,
    from: string | number | null,
    to: string | number | null,
  ): void => {
    if (from !== null || to !== null) events.push({ kind, payload: { from, to } });
  };

  transition("state", node.fromStateId, node.toStateId);
  transition("assignee", node.fromAssigneeId, node.toAssigneeId);
  transition("priority", node.fromPriority, node.toPriority);
  transition("estimate", node.fromEstimate, node.toEstimate);
  transition("dueDate", node.fromDueDate, node.toDueDate);
  transition("project", node.fromProjectId, node.toProjectId);
  transition("cycle", node.fromCycleId, node.toCycleId);
  transition("parent", node.fromParentId, node.toParentId);
  transition("title", node.fromTitle, node.toTitle);

  if (node.updatedDescription === true) {
    events.push({ kind: "description", payload: {} });
  }

  const added = node.addedLabelIds ?? [];
  const removed = node.removedLabelIds ?? [];
  if (added.length > 0 || removed.length > 0) {
    events.push({ kind: "labels", payload: { added: [...added], removed: [...removed] } });
  }

  if (node.attachmentId !== null) {
    events.push({ kind: "attachment", payload: { attachmentId: node.attachmentId } });
  }

  if (node.relationChanges !== null && node.relationChanges.length > 0) {
    events.push({
      kind: "relations",
      payload: {
        changes: node.relationChanges.map((change) => ({
          identifier: change.identifier,
          type: change.type,
        })),
      },
    });
  }

  if (node.archived !== null || node.autoArchived === true || node.autoClosed === true) {
    events.push({
      kind: "archived",
      payload: {
        archived: node.archived,
        autoArchived: node.autoArchived,
        autoClosed: node.autoClosed,
      },
    });
  }

  // Linear documents `trashed` as "trashed or un-trashed": false is a restore,
  // null is no change.
  if (node.trashed !== null && node.trashed !== undefined) {
    events.push({ kind: "trashed", payload: { trashed: node.trashed } });
  }

  transition("team", node.fromTeamId, node.toTeamId);
  transition(
    "milestone",
    node.fromProjectMilestone?.id ?? null,
    node.toProjectMilestone?.id ?? null,
  );

  return events.length === 0 ? null : events;
}
