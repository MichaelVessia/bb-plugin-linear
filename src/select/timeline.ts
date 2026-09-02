import type { CommentView, TimelineEntry } from "../contract.js";
import { formatActivityTime, formatDateTime, formatTimelessDate } from "../format.js";
import { formatEstimate } from "./detail.js";
import type { HistoryEventRow, MemberRow } from "../store/rows.js";

export interface TimelineVocabulary {
  readonly states: ReadonlyMap<string, string>;
  readonly members: ReadonlyMap<string, string>;
  readonly priorities: ReadonlyMap<number, string>;
  readonly projects: ReadonlyMap<string, string>;
  readonly cycles: ReadonlyMap<string, string>;
  readonly issues: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
  readonly teams: ReadonlyMap<string, string>;
  readonly milestones: ReadonlyMap<string, string>;
  readonly estimationType: string;
}

const stringValue = (payload: Readonly<Record<string, unknown>>, key: string): string | null =>
  typeof payload[key] === "string" ? payload[key] : null;
const numberValue = (payload: Readonly<Record<string, unknown>>, key: string): number | null =>
  typeof payload[key] === "number" ? payload[key] : null;
const name = (map: ReadonlyMap<string, string>, id: string | null, fallback: string): string =>
  id === null ? fallback : (map.get(id) ?? fallback);

/** Linear-style, workspace-aware prose for one normalized history event. */
export function describeEvent(
  event: Pick<HistoryEventRow, "kind" | "payload"> | { kind: "created"; payload: {} },
  vocab: TimelineVocabulary,
): string {
  const payload: Readonly<Record<string, unknown>> = event.payload;
  const from = stringValue(payload, "from");
  const to = stringValue(payload, "to");
  switch (event.kind) {
    case "created":
      return "created the issue";
    case "state":
      return from !== null && to !== null
        ? `changed status from ${name(vocab.states, from, "a state")} to ${name(vocab.states, to, "a state")}`
        : `changed status to ${name(vocab.states, to, "a state")}`;
    case "assignee":
      return to === null
        ? `unassigned ${name(vocab.members, from, "someone")}`
        : `assigned to ${name(vocab.members, to, "someone")}`;
    case "priority": {
      const next = numberValue(payload, "to");
      return next === null ? "removed the priority" : `set priority to ${vocab.priorities.get(next) ?? "a priority"}`;
    }
    case "estimate": {
      const next = numberValue(payload, "to");
      return next === null
        ? "removed the estimate"
        : `set estimate to ${formatEstimate(next, vocab.estimationType) ?? String(next)}`;
    }
    case "dueDate":
      return to === null ? "removed the due date" : `set due date to ${formatTimelessDate(to)}`;
    case "project":
      return from !== null && to !== null
        ? `moved from project ${name(vocab.projects, from, "a project")} to ${name(vocab.projects, to, "a project")}`
        : to === null
          ? `removed from project ${name(vocab.projects, from, "a project")}`
          : `added to project ${name(vocab.projects, to, "a project")}`;
    case "cycle":
      return to === null
        ? `removed from cycle ${name(vocab.cycles, from, "a cycle")}`
        : `added to cycle ${name(vocab.cycles, to, "a cycle")}`;
    case "parent":
      return to === null
        ? "removed the parent"
        : `set parent to ${name(vocab.issues, to, "an issue")}`;
    case "title":
      return from !== null && to !== null
        ? `changed title from ${from} to ${to}`
        : "changed the title";
    case "description":
      return "edited the description";
    case "labels": {
      const added = Array.isArray(payload.added)
        ? payload.added.filter((id): id is string => typeof id === "string")
        : [];
      const removed = Array.isArray(payload.removed)
        ? payload.removed.filter((id): id is string => typeof id === "string")
        : [];
      const phrases = [
        ...added.map((id) => `added label ${name(vocab.labels, id, "a label")}`),
        ...removed.map((id) => `removed label ${name(vocab.labels, id, "a label")}`),
      ];
      return phrases.join(" and ") || "changed labels";
    }
    case "attachment":
      return "linked an attachment";
    case "relations": {
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      const phrases = changes.flatMap((raw) => {
        if (typeof raw !== "object" || raw === null) return [];
        const identifier = "identifier" in raw && typeof raw.identifier === "string" ? raw.identifier : "an issue";
        const original = "type" in raw && typeof raw.type === "string" ? raw.type : "";
        const lowered = original.toLowerCase();
        const removed = /^(?:remove(?:d)?|delete(?:d)?|unlink(?:ed)?)(?:[_:-]|$)/.test(lowered);
        // Linear's relationChanges strings are not represented by an enum in
        // the vendored schema. Treat observed add/added and remove variants as
        // action affixes, then map both blocked and blocked_by spellings.
        const type = lowered
          .replace(/^(?:add(?:ed)?|remove(?:d)?|delete(?:d)?|unlink(?:ed)?)(?:[_:-]*)/, "")
          .replace(/^[_:-]+|[_:-]+$/g, "");
        if (removed) return [`removed a relation with ${identifier}`];
        if (type === "blocks") return [`marked as blocking ${identifier}`];
        if (type === "blocked" || type === "blocked_by") return [`marked as blocked by ${identifier}`];
        if (type === "related") return [`related to ${identifier}`];
        if (type === "duplicate") return [`marked as duplicate of ${identifier}`];
        if (type === "similar") return [`marked as similar to ${identifier}`];
        return [`changed a relation with ${identifier}`];
      });
      return phrases.join(" and ") || "changed a relation";
    }
    case "archived":
      // Auto-close is a state change Linear records on the archive channel;
      // calling it "archived" misdescribes what happened to the issue.
      if (payload.archived === false) return "unarchived";
      if (payload.archived === true) return "archived";
      if (payload.autoClosed === true) return "auto-closed";
      return "auto-archived";
    case "trashed":
      return payload.trashed === false ? "restored from trash" : "trashed";
    case "team":
      return `moved to team ${name(vocab.teams, to, "a team")}`;
    case "milestone":
      return to === null
        ? `removed from milestone ${name(vocab.milestones, from, "a milestone")}`
        : `added to milestone ${name(vocab.milestones, to, "a milestone")}`;
  }
}

type FlatComment = Omit<CommentView, "replies">;

/** Attach every reply to its top-level ancestor; cycles and orphans stay roots. */
export function nestComments(comments: readonly FlatComment[]): CommentView[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const roots = new Map<string, FlatComment>();
  const replies = new Map<string, FlatComment[]>();
  for (const comment of comments) {
    let root = comment;
    let parentId = comment.parentId;
    const seen = new Set([comment.id]);
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (parent === undefined || seen.has(parent.id)) break;
      seen.add(parent.id);
      root = parent;
      parentId = parent.parentId;
    }
    if (root.id === comment.id) roots.set(comment.id, comment);
    else replies.set(root.id, [...(replies.get(root.id) ?? []), comment]);
  }
  return [...roots.values()]
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))
    .map((root) => ({
      ...root,
      replies: [...(replies.get(root.id) ?? [])].sort(
        (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id),
      ),
    }));
}

function actorView(member: MemberRow | undefined) {
  if (member === undefined) return null;
  const words = member.displayName.trim().split(/\s+/).filter(Boolean);
  const initials = `${[...(words[0] ?? "?")][0] ?? "?"}${words.length > 1 ? ([...(words[1] ?? "")][0] ?? "") : ""}`.toUpperCase();
  return { name: member.displayName, initials, avatarUrl: member.avatarUrl };
}

const unknownHumanActor = { name: "Someone", initials: "?", avatarUrl: null } as const;

export function buildTimeline(input: {
  readonly issueId: string;
  readonly createdAt: number | null;
  readonly creatorId: string | null;
  readonly comments: readonly CommentView[];
  readonly events: readonly HistoryEventRow[];
  readonly members: ReadonlyMap<string, MemberRow>;
  readonly vocab: TimelineVocabulary;
  readonly now: number;
}): TimelineEntry[] {
  const fallbackAt = Math.min(
    ...[
      ...input.events.map((event) => event.createdAt),
      ...input.comments.map((comment) => comment.createdAt).filter((at): at is number => at !== null),
      input.now,
    ],
  );
  const createdAt = input.createdAt ?? fallbackAt;
  const createdActor = input.creatorId === null ? undefined : input.members.get(input.creatorId);
  const created: TimelineEntry = {
    kind: "event",
    id: `${input.issueId}:created`,
    at: createdAt,
    atRelative: formatActivityTime(createdAt, input.now),
    atAbsolute: formatDateTime(createdAt),
    actor:
      input.creatorId === null
        ? null
        : (actorView(createdActor) ?? unknownHumanActor),
    bot: input.creatorId === null ? "Linear" : null,
    text: "created the issue",
  };

  const merged: Array<{ at: number; order: number; entry: TimelineEntry }> = [
    ...input.events.map((event) => {
      const actor = event.actorId === null ? undefined : input.members.get(event.actorId);
      return {
        at: event.createdAt,
        order: 1,
        entry: {
          kind: "event" as const,
          id: event.id,
          at: event.createdAt,
          atRelative: formatActivityTime(event.createdAt, input.now),
          atAbsolute: formatDateTime(event.createdAt),
          actor:
            event.actorId === null
              ? null
              : (actorView(actor) ?? unknownHumanActor),
          bot: event.actorId === null ? (event.botName ?? "Linear") : null,
          text: describeEvent(event, input.vocab),
        },
      };
    }),
    ...input.comments.map((comment) => ({
      at: comment.createdAt ?? Number.MAX_SAFE_INTEGER,
      order: 2,
      entry: { kind: "comment" as const, commentId: comment.id },
    })),
  ];
  merged.sort((a, b) => a.at - b.at || a.order - b.order);
  return [created, ...merged.map((entry) => entry.entry)];
}
