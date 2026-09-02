import type {
  CommentView,
  DetailView,
  PropertyView,
  StateOption,
  SubIssueView,
} from "../contract.js";
import { formatActivityTime, formatDateTime, formatTimelessDate, pluralize, truncate } from "../format.js";
import { rewriteLinearImages } from "../image-proxy.js";
import { renderMentions } from "./mentions-markup.js";
import { buildTimeline, nestComments, type TimelineVocabulary } from "./timeline.js";
import type {
  ActivityCursorRow,
  AttachmentRow,
  CommentRow,
  CustomerNeedRow,
  DocumentRow,
  HistoryEventRow,
  LabelRow,
  MemberRow,
  ReactionRow,
  RelationDetailRow,
  TeamRow,
  WorkflowStateRow,
} from "../store/rows.js";
import type { IssueRow } from "../store/rows.js";
import { toneForStateType, type Tone } from "./tone.js";

/**
 * The detail pane, as data.
 *
 * Ordered by what you need when you open an issue, with controls after
 * content: identifier and state first, then the description, then the
 * properties, then sub-issues, relations, attachments, comments, and last the
 * facts nobody needs first — created, updated, creator, previous identifiers.
 */

export type { CommentView, DetailView, PropertyView, StateOption, SubIssueView };

export interface DetailContext {
  readonly issue: IssueRow;
  readonly team: TeamRow | null;
  readonly states: readonly WorkflowStateRow[];
  readonly members: ReadonlyMap<string, MemberRow>;
  readonly labels: ReadonlyMap<string, LabelRow>;
  readonly priorityLabels: ReadonlyMap<number, string>;
  readonly comments: readonly CommentRow[];
  readonly commentsTruncated: boolean;
  readonly subIssues: readonly { id: string; identifier: string; title: string; type: string }[];
  readonly projectName: string | null;
  readonly cycleName: string | null;
  readonly milestoneName: string | null;
  readonly attachments: readonly AttachmentRow[];
  readonly relations: readonly RelationDetailRow[];
  readonly history: readonly HistoryEventRow[];
  readonly reactions: readonly ReactionRow[];
  readonly subscribers: readonly MemberRow[];
  /** How many subscribers Linear reported, which can exceed `subscribers`
   *  when some belong to teams the mirror has never met. */
  readonly subscriberCount?: number;
  readonly documents: readonly DocumentRow[];
  readonly needs: readonly CustomerNeedRow[];
  readonly parent: { id: string; identifier: string; title: string; tone: Tone } | null;
  readonly lastOpenedAt: number | null;
  readonly showActivity: boolean;
  readonly viewerId: string | null;
  readonly cursors: ActivityCursorRow | null;
  readonly now: number;
  readonly vocabulary: TimelineVocabulary;
}

/** Linear's own grouping order for a state picker. */
const TYPE_ORDER: Record<string, number> = {
  triage: 0,
  backlog: 1,
  unstarted: 2,
  started: 3,
  completed: 4,
  canceled: 5,
  duplicate: 6,
};

/**
 * `Team.issueEstimationType` is one of `notUsed | exponential | fibonacci |
 * linear | tShirt`, and **estimates are not "points"**. Rendering "3 points"
 * on a t-shirt team is wrong in a way that makes the whole panel look like it
 * does not know the workspace it is looking at.
 */
export function formatEstimate(value: number | null, estimationType: string): string | null {
  if (value === null) return null;
  if (estimationType === "notUsed") return null;
  if (estimationType === "tShirt") {
    return T_SHIRT[value] ?? `${value}`;
  }
  return `${value} ${pluralize(value, "point", "points")}`;
}

/** Linear's t-shirt scale, in its own order. Index 0 is "no estimate" and
 *  never renders, because `formatEstimate` is only reached with a value. */
const T_SHIRT: Record<number, string> = {
  1: "XS",
  2: "S",
  3: "M",
  5: "L",
  8: "XL",
  13: "XXL",
};

/**
 * The values a team's estimate scale actually offers.
 *
 * Linear does not expose the scale as data — only the *name* of the scale on
 * `Team.issueEstimationType` — so these are the sequences Linear's own picker
 * uses, reproduced. Offering a free number field instead would let somebody
 * set 7 on a fibonacci team, which Linear accepts and then renders as a value
 * that is not on the board.
 *
 * `estimationAllowZero` decides whether "no estimate" is a choice or just the
 * absence of one, and `estimationExtended` adds the tail Linear adds. Both come
 * straight off the team.
 */
export function estimateScale(
  estimationType: string,
  options: { allowZero: boolean; extended: boolean },
): number[] {
  const base = ESTIMATE_SCALES[estimationType];
  if (base === undefined) return [];
  const values = options.extended ? base.extended : base.standard;
  return options.allowZero ? [0, ...values] : [...values];
}

const ESTIMATE_SCALES: Record<string, { standard: number[]; extended: number[] }> = {
  exponential: { standard: [1, 2, 4, 8, 16], extended: [1, 2, 4, 8, 16, 32, 64] },
  fibonacci: { standard: [1, 2, 3, 5, 8], extended: [1, 2, 3, 5, 8, 13, 21] },
  linear: { standard: [1, 2, 3, 4, 5], extended: [1, 2, 3, 4, 5, 6, 7] },
  tShirt: { standard: [1, 2, 3, 5, 8], extended: [1, 2, 3, 5, 8, 13] },
};

/** What one scale value is called. The t-shirt scale is the reason this is not
 *  just the number: a team on t-shirts never wants to read "5". */
export function estimateLabel(value: number, estimationType: string): string {
  if (value === 0) return "No estimate";
  return formatEstimate(value, estimationType) ?? `${String(value)}`;
}

export function selectDetail(context: DetailContext): DetailView {
  const { issue } = context;
  const state = context.states.find((entry) => entry.id === issue.stateId) ?? null;
  const tone = toneForStateType(state?.type);
  const assignee = issue.assigneeId === null ? null : context.members.get(issue.assigneeId);
  const creator = issue.creatorId === null ? null : context.members.get(issue.creatorId);
  const estimationType = context.team?.estimationType ?? "notUsed";

  const properties: PropertyView[] = [];
  const push = (key: string, label: string, value: string | null, propertyTone?: Tone) => {
    // A property with no value does not render. A detail pane full of
    // "Assignee: —" rows is a pane that has to be read past rather than read.
    if (value === null || value === "") return;
    properties.push(propertyTone === undefined ? { key, label, value } : { key, label, value, tone: propertyTone });
  };

  push("assignee", "Assignee", assignee?.displayName ?? null);
  push("priority", "Priority", context.priorityLabels.get(issue.priority) ?? null);
  push(
    "estimate",
    "Estimate",
    estimationType === "notUsed" ? null : formatEstimate(issue.estimate, estimationType),
  );
  push("project", "Project", context.projectName);
  push("milestone", "Milestone", context.milestoneName);
  push("cycle", "Cycle", context.cycleName);
  push(
    "due",
    "Due",
    issue.dueDate === null ? null : formatTimelessDate(issue.dueDate),
    issue.dueDate === null ? undefined : "triage",
  );

  const fields: DetailView["fields"] = {
    assignee:
      assignee === undefined || assignee === null
        ? null
        : {
            id: assignee.id,
            name: assignee.displayName || assignee.name,
            initials: initials(assignee.displayName || assignee.name),
            avatarUrl: assignee.avatarUrl,
          },
    priority: issue.priority,
    priorityLabel: context.priorityLabels.get(issue.priority) ?? "",
    estimate: issue.estimate,
    estimateLabel: estimationType === "notUsed" ? null : formatEstimate(issue.estimate, estimationType),
    dueDate: issue.dueDate,
    dueDateLabel: issue.dueDate === null ? null : formatTimelessDate(issue.dueDate),
    projectId: issue.projectId,
    projectName: context.projectName,
    cycleId: issue.cycleId,
    cycleName: context.cycleName,
  };

  const footnotes: PropertyView[] = [];
  if (creator !== undefined && creator !== null) {
    footnotes.push({ key: "creator", label: "Created by", value: creator.displayName });
  }

  const reactionViews = (commentId: string | null) => {
    const grouped = new Map<string, ReactionRow[]>();
    for (const reaction of context.reactions) {
      if (reaction.commentId !== commentId) continue;
      grouped.set(reaction.emoji, [...(grouped.get(reaction.emoji) ?? []), reaction]);
    }
    return [...grouped.entries()].map(([emoji, rows]) => ({
      emoji,
      count: rows.length,
      mine: context.viewerId !== null && rows.some((row) => row.userId === context.viewerId),
      ids: rows.map((row) => row.id),
    }));
  };

  const markdown = (value: string): string =>
    renderMentions(rewriteLinearImages(value, issue.id));
  const flatComments = context.comments.map((comment) => {
    const author = comment.userId === null ? undefined : context.members.get(comment.userId);
    const name = author?.displayName ?? "Someone";
    const resolvedBy =
      comment.resolvingUserId === null || comment.resolvingUserId === undefined
        ? null
        : (context.members.get(comment.resolvingUserId)?.displayName ?? null);
    return {
      id: comment.id,
      body: markdown(comment.body),
      author: name,
      authorInitials: initials(name),
      avatarUrl: author?.avatarUrl ?? null,
      createdAt: comment.createdAt,
      createdAtRelative:
        comment.createdAt === null ? null : formatActivityTime(comment.createdAt, context.now),
      createdAtAbsolute:
        comment.createdAt === null ? null : formatDateTime(comment.createdAt),
      edited: comment.editedAt !== null,
      parentId: comment.parentId,
      url: comment.url,
      resolved: comment.resolvedAt !== null,
      resolvedBy,
      reactions: reactionViews(comment.id),
    };
  });
  const comments = nestComments(flatComments);

  const resourcesBySource = new Map<
    string,
    { source: string; label: string; newest: number; items: DetailView["resources"]["groups"][number]["items"] }
  >();
  const sourceLabel = (source: string): string =>
    source === "links"
      ? "Links"
      : source.toLowerCase() === "github"
        ? "GitHub"
      : source.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  for (const attachment of context.attachments) {
    const plainLink =
      attachment.sourceType === null ||
      attachment.sourceType === "" ||
      attachment.sourceType.toLowerCase() === "url" ||
      attachment.sourceType.toLowerCase() === "link";
    const source =
      attachment.groupBySource && !plainLink
        ? attachment.sourceType
        : "links";
    const existing = resourcesBySource.get(source) ?? {
      source,
      label: sourceLabel(source),
      newest: 0,
      items: [],
    };
    existing.newest = Math.max(existing.newest, attachment.createdAt ?? 0);
    existing.items.push({
      id: attachment.id,
      title: attachment.title,
      subtitle: attachment.subtitle,
      url: attachment.url,
      createdAt: attachment.createdAt,
      kind: "attachment",
    });
    resourcesBySource.set(source, existing);
  }
  if (context.documents.length > 0) {
    resourcesBySource.set("documents", {
      source: "documents",
      label: "Documents",
      newest: Math.max(...context.documents.map((document) => document.updatedAt ?? 0)),
      items: context.documents.map((document) => ({
        id: document.id,
        title: document.title,
        subtitle: null,
        url: document.url,
        createdAt: document.updatedAt,
        kind: "document" as const,
      })),
    });
  }
  const resources = {
    groups: [...resourcesBySource.values()]
      .sort((a, b) => b.newest - a.newest || a.label.localeCompare(b.label))
      .map(({ source, label, items }) => ({
        source,
        label,
        items: [...items].sort(
          (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.title.localeCompare(b.title),
        ),
      })),
  };

  const emptyRelations: DetailView["relations"] = {
    blockedBy: [],
    blocks: [],
    related: [],
    duplicateOf: [],
    duplicates: [],
  };
  for (const relation of context.relations) {
    const item = {
      relationId: relation.id,
      id: relation.counterpartId,
      identifier: relation.identifier ?? relation.counterpartId,
      title: relation.title ?? "Unknown issue",
      tone: toneForStateType(relation.stateType),
      done: relation.stateType === "completed" || relation.stateType === "canceled",
    };
    if (relation.type === "blocks") {
      (relation.inverse ? emptyRelations.blockedBy : emptyRelations.blocks).push(item);
    } else if (relation.type === "duplicate") {
      (relation.inverse ? emptyRelations.duplicates : emptyRelations.duplicateOf).push(item);
    } else {
      emptyRelations.related.push(item);
    }
  }

  const timeline = buildTimeline({
    issueId: issue.id,
    createdAt: issue.createdAt,
    creatorId: issue.creatorId,
    comments,
    events: context.history,
    members: context.members,
    vocab: context.vocabulary,
    now: context.now,
  });

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description === null ? null : markdown(issue.description),
    stateId: issue.stateId,
    stateName: state?.name ?? "Unknown state",
    tone,
    struckThrough: tone === "canceled",
    fields,
    stateOptions: [...context.states]
      .sort((a, b) =>
        (TYPE_ORDER[a.type] ?? 9) === (TYPE_ORDER[b.type] ?? 9)
          ? a.position - b.position
          : (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9),
      )
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        tone: toneForStateType(entry.type),
      })),
    properties,
    labels: issue.labelIds
      .map((id) => context.labels.get(id))
      .filter((label): label is LabelRow => label !== undefined)
      .map((label) => ({ id: label.id, name: label.name, color: label.color })),
    subIssues: context.subIssues.map((child) => ({
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      tone: toneForStateType(child.type),
      done: child.type === "completed" || child.type === "canceled",
    })),
    parent: context.parent,
    resources,
    relations: emptyRelations,
    reactions: reactionViews(null),
    comments,
    commentsTruncated: context.commentsTruncated,
    subscribers: {
      count: Math.max(context.subscriberCount ?? 0, context.subscribers.length),
      people: context.subscribers.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        initials: initials(member.displayName),
        avatarUrl: member.avatarUrl,
      })),
    },
    customerRequests: context.needs.map((need) => ({
      id: need.id,
      customer: need.customerName ?? "Unknown customer",
      priority: need.priority,
      excerpt: truncate((need.body ?? "").replace(/\s+/g, " ").trim(), 180),
      url: need.url,
    })),
    timeline,
    unreadBoundaryAt: context.lastOpenedAt,
    activity: {
      showActivity: context.showActivity,
      hasOlder: context.cursors?.commentsMore === true || context.cursors?.historyMore === true,
    },
    footnotes,
    teamKey: context.team?.key ?? "",
    teamName: context.team?.name ?? "",
    usesEstimates: estimationType !== "notUsed",
    branchName: issue.branchName,
  };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...(words[0] ?? "")][0] ?? "";
  const second = words.length > 1 ? ([...(words[1] ?? "")][0] ?? "") : "";
  return `${first}${second}`.toUpperCase();
}
