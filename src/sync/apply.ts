import { parseInstant } from "../format.js";
import type {
  BootstrapResult,
  BreadthResult,
  IssueRelationsResult,
  IssueActivityPageResult,
  IssueDetailNode,
  IssueHistoryNode,
  IssueNode,
  InverseRelationNode,
  RelationNode,
  TickIssueNode,
  TeamGraphResult,
} from "../linear/types.js";
import type { IssueInput, Store, TeamInput } from "../store/store.js";
import type {
  AttachmentRow,
  CommentRow,
  CustomerNeedRow,
  CycleRow,
  DocumentRow,
  HistoryEventRow,
  LabelRow,
  MemberRow,
  MilestoneRow,
  ProjectRow,
  ReactionRow,
  RelationRow,
  WorkflowStateRow,
} from "../store/rows.js";
import { normalizeHistory } from "./history.js";

/**
 * The one boundary where Linear's shapes become the mirror's rows.
 *
 * Three things happen here and nowhere else, which is the point of having a
 * single file for it:
 *
 * **ISO-8601 becomes epoch milliseconds, exactly once.** Every timestamp is
 * parsed here and never re-parsed; everything downstream compares integers.
 * A value that does not parse becomes `null` rather than `NaN`, because a
 * `NaN` in a column silently poisons every comparison it takes part in and
 * does it three frames from the parse.
 *
 * **Relations flatten to ids.** Linear returns `{ team: { id } }`; the mirror
 * stores `team_id`. Doing it here means no query anywhere else has to know
 * that Linear nests.
 *
 * **`TimelessDate` stays a string.** `dueDate` is a calendar fact, not an
 * instant, and converting it picks a timezone on the user's behalf.
 *
 * Every write is an upsert keyed on Linear's `id`, which is what makes the
 * poller's deliberate watermark overlap free: re-reading a page costs one
 * request and changes nothing.
 */

export function applyBootstrap(
  store: Store,
  result: BootstrapResult,
  at: number,
  /** Which settings slot's key produced this. A Linear key is scoped to one
   *  workspace, so this is also the answer to "which key can reach these
   *  teams" for every team in the result. */
  slot: string,
): void {
  const { viewer } = result;

  store.putWorkspace(
    {
      id: viewer.organization.id,
      slot,
      name: viewer.organization.name,
      urlKey: viewer.organization.urlKey,
      viewerId: viewer.id,
      viewerName: viewer.displayName,
      gitBranchFormat: viewer.organization.gitBranchFormat,
    },
    at,
  );

  // The viewer is a member row like any other, flagged `is_me`. That is what
  // lets "assigned to you" be a plain query rather than a special case
  // threaded through every filter.
  store.putMembers([
    {
      id: viewer.id,
      workspaceId: viewer.organization.id,
      name: viewer.name,
      displayName: viewer.displayName,
      email: viewer.email,
      avatarUrl: viewer.avatarUrl,
      active: true,
      isApp: false,
      isMe: true,
      updatedAt: at,
    },
  ]);

  // Project statuses are workspace-level (`Organization.projectStatuses`),
  // unlike issue workflow states, which are team-level. The two look
  // symmetrical and are scoped differently.
  store.replaceProjectStatuses(
    viewer.organization.projectStatuses.map((status) => ({
      id: status.id,
      workspaceId: viewer.organization.id,
      name: status.name,
      type: status.type,
      position: status.position,
      color: status.color,
    })),
    viewer.organization.id,
  );

  store.replacePriorityValues(
    result.issuePriorityValues.map((value) => ({
      priority: value.priority,
      label: value.label,
      workspaceId: viewer.organization.id,
    })),
    viewer.organization.id,
  );

  store.putTeams(
    result.teams.nodes.map((node) => toTeam(node, viewer.organization.id)),
    at,
  );
}

function toTeam(
  node: BootstrapResult["teams"]["nodes"][number],
  workspaceId: string,
): TeamInput {
  return {
    id: node.id,
    workspaceId,
    key: node.key,
    name: node.name,
    icon: node.icon,
    color: node.color,
    parentId: node.parent?.id ?? null,
    estimationType: node.issueEstimationType,
    estimationAllowZero: node.issueEstimationAllowZero,
    estimationExtended: node.issueEstimationExtended,
    defaultEstimate: node.defaultIssueEstimate,
    cyclesEnabled: node.cyclesEnabled,
    triageEnabled: node.triageEnabled,
    activeCycleId: node.activeCycle?.id ?? null,
    updatedAt: parseInstant(node.updatedAt),
  };
}

/**
 * States are **replaced** per team rather than upserted, because a state
 * deleted in Linear has no tombstone: an upsert would leave it in the picker
 * forever, and picking it would fail with an error about an id that no longer
 * exists. Members are also replaced per workspace: the active-users query has
 * no tombstone for someone who left, so upserting would retain them forever.
 */
export function applyTeamGraph(
  store: Store,
  result: TeamGraphResult,
  teamIds: readonly string[],
  at: number,
): void {
  const workspaceId =
    teamIds
      .map((teamId) => store.workspaceForTeam(teamId)?.id ?? null)
      .find((id): id is string => id !== null) ?? store.workspace()?.id;
  const byTeam = new Map<string, WorkflowStateRow[]>();
  for (const teamId of teamIds) byTeam.set(teamId, []);
  for (const node of result.workflowStates.nodes) {
    const list = byTeam.get(node.team.id);
    if (list === undefined) continue;
    list.push({
      id: node.id,
      teamId: node.team.id,
      name: node.name,
      type: node.type,
      color: node.color,
      position: node.position,
      description: node.description,
    });
  }
  for (const [teamId, states] of byTeam) {
    // A team that came back with no states at all is a team whose page was
    // truncated or whose request partially failed — replacing with an empty
    // list would erase a working state picker. Nothing is a safer answer than
    // wrong.
    if (states.length === 0) continue;
    store.replaceWorkflowStates(teamId, states);
  }

  const labels: LabelRow[] = result.issueLabels.nodes.map((node) => ({
    id: node.id,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    teamId: node.team?.id ?? null,
    name: node.name,
    color: node.color,
    parentId: node.parent?.id ?? null,
    isGroup: node.isGroup,
    updatedAt: parseInstant(node.updatedAt),
  }));
  store.putLabels(labels);

  const members: MemberRow[] = result.users.nodes.map((node) => ({
    id: node.id,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    name: node.name,
    displayName: node.displayName,
    email: node.email,
    avatarUrl: node.avatarUrl,
    active: node.active,
    isApp: node.app,
    isMe: node.isMe,
    updatedAt: at,
  }));
  if (workspaceId === undefined) store.putMembers(members);
  else store.replaceWorkspaceMembers(workspaceId, members);
}

export function toIssueInput(node: IssueNode): IssueInput {
  return {
    id: node.id,
    identifier: node.identifier,
    number: node.number,
    teamId: node.team.id,
    title: node.title,
    description: node.description,
    url: node.url,
    branchName: node.branchName,
    priority: node.priority,
    estimate: node.estimate,
    stateId: node.state.id,
    assigneeId: node.assignee?.id ?? null,
    creatorId: node.creator?.id ?? null,
    projectId: node.project?.id ?? null,
    milestoneId: node.projectMilestone?.id ?? null,
    cycleId: node.cycle?.id ?? null,
    parentId: node.parent?.id ?? null,
    // Stays a string. See the header comment.
    dueDate: node.dueDate,
    sortOrder: node.sortOrder,
    subIssueSortOrder: node.subIssueSortOrder,
    labelIds: node.labelIds,
    startedAt: parseInstant(node.startedAt),
    completedAt: parseInstant(node.completedAt),
    canceledAt: parseInstant(node.canceledAt),
    triagedAt: parseInstant(node.triagedAt),
    archivedAt: parseInstant(node.archivedAt),
    createdAt: parseInstant(node.createdAt),
    updatedAt: parseInstant(node.updatedAt) ?? 0,
  };
}

/**
 * Write a page of issues, and return the watermark this page justifies.
 *
 * The returned value is the **oldest** `updatedAt` in the page, not the
 * newest and not `Date.now()`. Checkpointing to the newest means a crash
 * mid-walk skips everything the walk had not reached; checkpointing to the
 * local clock means drifting against Linear's, which produces the same skip
 * with no crash required. The oldest re-reads a page instead of losing one,
 * and re-reading is free because every write is an upsert by id.
 */
export function applyIssues(
  store: Store,
  nodes: readonly IssueNode[],
  at: number,
): {
  readonly written: number;
  readonly oldestUpdatedAt: number | null;
  readonly newestUpdatedAt: number | null;
} {
  if (nodes.length === 0) {
    return { written: 0, oldestUpdatedAt: null, newestUpdatedAt: null };
  }

  const rows = nodes.map(toIssueInput);
  const written = store.putIssues(rows, at);

  for (const node of nodes) {
    if (node.previousIdentifiers.length > 0) {
      // An issue moved between teams changes identifier, which is why this
      // field exists. Keeping the trail is what stops a link written last
      // month resolving to "no such issue".
      store.putPreviousIdentifiers(node.id, node.previousIdentifiers);
    }
    if (isTickIssue(node)) {
      store.mergeAttachments(toAttachmentRows(node.id, node.attachments.nodes));
      store.mergeRelations(
        relationRowsFor(node.id, node.relations.nodes, node.inverseRelations.nodes),
      );
    }
  }

  let oldest: number | null = null;
  let newest: number | null = null;
  for (const row of rows) {
    if (oldest === null || row.updatedAt < oldest) oldest = row.updatedAt;
    if (newest === null || row.updatedAt > newest) newest = row.updatedAt;
  }
  return { written, oldestUpdatedAt: oldest, newestUpdatedAt: newest };
}

/**
 * One issue, in full, from the detail query.
 *
 * Writes the issue, its comments and its children in one pass, because the
 * detail pane reads all three and a pane that renders the issue and then the
 * comments a beat later reads as slow even when it is not.
 */
export interface ApplyActivityOptions {
  readonly debug?: (message: string) => void;
  /** Older paging advances each lane independently. An exhausted comments
   * lane still appears in the shared document but must not reconcile an empty
   * refetch over every comment already mirrored. */
  readonly commentsActive?: boolean;
  readonly historyActive?: boolean;
}

function verifyNewestFirst(
  lane: "comments" | "history",
  nodes: readonly { readonly createdAt: string }[],
  debug?: (message: string) => void,
): void {
  if (nodes.length < 2 || debug === undefined) return;
  const first = parseInstant(nodes[0]!.createdAt);
  const last = parseInstant(nodes[nodes.length - 1]!.createdAt);
  if (first !== null && last !== null && first < last) {
    debug(`Linear ${lane} page was not newest-first; preserving client-side chronological order.`);
  }
}

function commentRows(issueId: string, nodes: IssueDetailNode["comments"]["nodes"], at: number): CommentRow[] {
  return nodes.map((comment) => ({
    id: comment.id,
    issueId: comment.issue?.id ?? issueId,
    userId: comment.user?.id ?? null,
    parentId: comment.parent?.id ?? null,
    body: comment.body,
    url: comment.url,
    createdAt: parseInstant(comment.createdAt),
    updatedAt: parseInstant(comment.updatedAt) ?? at,
    editedAt: parseInstant(comment.editedAt),
    resolvedAt: parseInstant(comment.resolvedAt),
    resolvingUserId: comment.resolvingUser?.id ?? null,
  }));
}

function reconcileCommentPage(
  store: Store,
  issueId: string,
  comments: readonly CommentRow[],
  hasOlder: boolean,
  reconcileEmptyCompleteWindow = true,
): void {
  const commentTimes = comments
    .map((comment) => comment.createdAt)
    .filter((value): value is number => value !== null);
  if (commentTimes.length > 0) {
    store.reconcileCommentsWindow(
      issueId,
      comments.map((comment) => comment.id),
      hasOlder ? Math.min(...commentTimes) : null,
      Math.max(...commentTimes),
    );
  } else if (!hasOlder && reconcileEmptyCompleteWindow) {
    store.reconcileCommentsWindow(issueId, [], null, null);
  }
}

export function applyIssueDetail(
  store: Store,
  node: IssueDetailNode,
  at: number,
  options: ApplyActivityOptions = {},
): void {
  const previousCursor = store.activityCursor(node.id);
  // A child that is **already in the mirror** is left alone. The detail query
  // returns four fields per child, and upserting that over a full row would
  // blank every other column until the poller happened to touch it again —
  // which is a worse row than the one it replaced, arriving as a side effect
  // of opening the parent.
  const existingChildren = new Set(
    store.issuesByIds(node.children.nodes.map((child) => child.id)).map((child) => child.id),
  );
  const stubs = node.children.nodes
    .filter((child) => !existingChildren.has(child.id))
    .map((child) => detailChildToNode(child, node));

  // The detail node is structurally also a tick node. Strip tick-only
  // connections before the shared issue write so attachments and relations
  // are written exactly once by the authoritative replace-all path below.
  const { attachments: _attachments, relations: _relations, inverseRelations: _inverse, ...baseNode } = node;
  applyIssues(store, [baseNode, ...stubs], at);

  // Parent and relation rows are expanded just enough to make the joined
  // store readers useful before the ordinary poller reaches those issues.
  // Existing full rows always win over these deliberately stale stubs. Their
  // impossible Linear number (0), combined with no parent id, keeps this
  // specific stub shape out of normal list/search/count reads without hiding
  // the pre-existing child stubs from those surfaces.
  const expanded = [
    ...(node.parent === null
      ? []
      : [{
          id: node.parent.id,
          identifier: node.parent.identifier,
          title: node.parent.title,
          stateId: null,
        }]),
    ...node.relations.nodes.flatMap((relation) =>
      relation.relatedIssue === null ||
      relation.relatedIssue.identifier === undefined ||
      relation.relatedIssue.title === undefined
        ? []
        : [{
            id: relation.relatedIssue.id,
            identifier: relation.relatedIssue.identifier,
            title: relation.relatedIssue.title,
            stateId: relation.relatedIssue.state?.id ?? null,
          }],
    ),
    ...node.inverseRelations.nodes.flatMap((relation) =>
      relation.issue === null ||
      relation.issue.identifier === undefined ||
      relation.issue.title === undefined
        ? []
        : [{
            id: relation.issue.id,
            identifier: relation.issue.identifier,
            title: relation.issue.title,
            stateId: relation.issue.state?.id ?? null,
          }],
    ),
  ];
  const existingExpanded = new Set(
    store.issuesByIds(expanded.map((entry) => entry.id)).map((issue) => issue.id),
  );
  const sourceTeam = store.team(node.team.id);
  store.putIssues(
    expanded
      .filter((entry) => !existingExpanded.has(entry.id))
      .flatMap((entry) => {
        const key = /^([A-Z][A-Z0-9]*)-\d+$/i.exec(entry.identifier)?.[1] ?? null;
        if (key === null) return [];
        const teamId =
          key.toUpperCase() === node.team.key.toUpperCase()
            ? node.team.id
            : (() => {
                if (sourceTeam === null) return null;
                const matches = store
                  .teamsByKey(key)
                  .filter((team) => team.workspaceId === sourceTeam.workspaceId);
                return matches.length === 1 ? matches[0]!.id : null;
              })();
        // A relation may cross teams or workspaces. Without an unambiguous
        // target team, retaining only the relation ids is safer than inventing
        // a fully queryable issue under the source issue's scope.
        return teamId === null ? [] : [detailStubInput(entry, teamId)];
      }),
    at,
  );

  verifyNewestFirst("comments", node.comments.nodes, options.debug);
  verifyNewestFirst("history", node.history.nodes, options.debug);
  const comments = commentRows(node.id, node.comments.nodes, at);
  store.putComments(comments);
  reconcileCommentPage(store, node.id, comments, node.comments.pageInfo.hasNextPage);

  store.replaceAttachments(node.id, toAttachmentRows(node.id, node.attachments.nodes));
  store.replaceRelations(
    node.id,
    relationRowsFor(node.id, node.relations.nodes, node.inverseRelations.nodes),
  );

  const historyRows: HistoryEventRow[] = [...node.history.nodes]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .flatMap((history) => historyRowsFor(node.id, history));
  store.putHistory(historyRows);

  const reactions: ReactionRow[] = [
    ...toReactionRows(node.id, null, node.reactions),
    ...node.comments.nodes.flatMap((comment) =>
      toReactionRows(node.id, comment.id, comment.reactions ?? []),
    ),
  ];
  store.replaceReactions(
    node.id,
    reactions,
    node.comments.nodes.map((comment) => comment.id),
  );
  store.replaceSubscribers(
    node.id,
    node.subscribers.nodes.map((subscriber) => subscriber.id),
  );
  store.replaceDocuments(
    node.id,
    node.documents.nodes.map<DocumentRow>((document) => ({
      id: document.id,
      issueId: node.id,
      title: document.title,
      url: document.url,
      updatedAt: parseInstant(document.updatedAt),
      icon: document.icon,
      color: document.color,
    })),
  );
  store.replaceCustomerNeeds(
    node.id,
    node.needs.nodes.map<CustomerNeedRow>((need) => ({
      id: need.id,
      issueId: node.id,
      customerName: need.customer?.name ?? null,
      priority: need.priority,
      body: need.body,
      url: need.url,
      createdAt: parseInstant(need.createdAt),
    })),
  );
  store.putActivityCursor({
    issueId: node.id,
    // A detail refresh is always the newest page. Once the user has advanced
    // an older-page cursor, retain that progress; the refreshed first page has
    // already merged any newly-created activity into the mirror. A now-complete
    // first page remains authoritative and clears stale paging state.
    commentsCursor:
      node.comments.pageInfo.hasNextPage && previousCursor !== null
        ? previousCursor.commentsCursor
        : (node.comments.pageInfo.endCursor ?? null),
    commentsMore:
      node.comments.pageInfo.hasNextPage && previousCursor !== null
        ? previousCursor.commentsMore
        : node.comments.pageInfo.hasNextPage,
    historyCursor:
      node.history.pageInfo.hasNextPage && previousCursor !== null
        ? previousCursor.historyCursor
        : (node.history.pageInfo.endCursor ?? null),
    historyMore:
      node.history.pageInfo.hasNextPage && previousCursor !== null
        ? previousCursor.historyMore
        : node.history.pageInfo.hasNextPage,
    direction: "after",
  });
}

/** Merge one older activity page and advance each lane's independent cursor. */
export function applyIssueActivityPage(
  store: Store,
  result: IssueActivityPageResult,
  at: number,
  options: ApplyActivityOptions = {},
): void {
  const { issue } = result;
  const previous = store.activityCursor(issue.id);
  const commentsActive = options.commentsActive ?? true;
  const historyActive = options.historyActive ?? true;
  if (commentsActive) {
    verifyNewestFirst("comments", issue.comments.nodes, options.debug);
    const comments = commentRows(issue.id, issue.comments.nodes, at);
    store.putComments(comments);
    // An empty `after:` page means there is nothing older. It says nothing
    // about the already-mirrored newest window and must never reconcile the
    // whole issue to empty.
    reconcileCommentPage(store, issue.id, comments, issue.comments.pageInfo.hasNextPage, false);
    const issueReactions = store
      .reactionsFor(issue.id)
      .filter((reaction) => reaction.commentId === null);
    store.replaceReactions(
      issue.id,
      [
        ...issueReactions,
        ...issue.comments.nodes.flatMap((comment) =>
          toReactionRows(issue.id, comment.id, comment.reactions ?? []),
        ),
      ],
      issue.comments.nodes.map((comment) => comment.id),
    );
  }
  if (historyActive) {
    verifyNewestFirst("history", issue.history.nodes, options.debug);
    store.putHistory(
      [...issue.history.nodes]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .flatMap((history) => historyRowsFor(issue.id, history)),
    );
  }
  store.putActivityCursor({
    issueId: issue.id,
    commentsCursor: commentsActive
      ? (issue.comments.pageInfo.endCursor ?? null)
      : (previous?.commentsCursor ?? null),
    commentsMore: commentsActive
      ? issue.comments.pageInfo.hasNextPage
      : (previous?.commentsMore ?? false),
    historyCursor: historyActive
      ? (issue.history.pageInfo.endCursor ?? null)
      : (previous?.historyCursor ?? null),
    historyMore: historyActive
      ? issue.history.pageInfo.hasNextPage
      : (previous?.historyMore ?? false),
    direction: "after",
  });
}

function isTickIssue(node: IssueNode): node is TickIssueNode {
  return "attachments" in node && "relations" in node && "inverseRelations" in node;
}

function toAttachmentRows(
  issueId: string,
  nodes: TickIssueNode["attachments"]["nodes"],
): AttachmentRow[] {
  return nodes.map((attachment) => ({
    id: attachment.id,
    issueId,
    title: attachment.title,
    subtitle: attachment.subtitle,
    url: attachment.url,
    sourceType: attachment.sourceType,
    groupBySource: attachment.groupBySource,
    createdAt: parseInstant(attachment.createdAt),
    updatedAt: parseInstant(attachment.updatedAt),
    creatorId: attachment.creator?.id ?? null,
  }));
}

function relationRowsFor(
  issueId: string,
  relations: readonly RelationNode[],
  inverseRelations: readonly InverseRelationNode[],
): RelationRow[] {
  return [
    ...relations.flatMap((relation) =>
      relation.relatedIssue === null
        ? []
        : [{
            id: relation.id,
            issueId,
            relatedIssueId: relation.relatedIssue.id,
            type: relation.type,
          }],
    ),
    ...inverseRelations.flatMap((relation) =>
      relation.issue === null
        ? []
        : [{
            id: relation.id,
            issueId: relation.issue.id,
            relatedIssueId: issueId,
            type: relation.type,
          }],
    ),
  ];
}

function historyRowsFor(issueId: string, node: IssueHistoryNode): HistoryEventRow[] {
  const normalized = normalizeHistory(node);
  if (normalized === null) return [];
  const createdAt = parseInstant(node.createdAt);
  if (createdAt === null) return [];
  return normalized.map((event) => ({
    id: `${node.id}:${event.kind}`,
    issueId,
    createdAt,
    actorId: node.actorId ?? node.actor?.id ?? null,
    botName: node.botActor?.name ?? null,
    kind: event.kind,
    payload: event.payload,
  }));
}

function toReactionRows(
  issueId: string,
  commentId: string | null,
  nodes: readonly { id: string; emoji: string; createdAt: string; user: { id: string } | null }[],
): ReactionRow[] {
  return nodes.map((reaction) => ({
    id: reaction.id,
    issueId,
    commentId,
    emoji: reaction.emoji,
    userId: reaction.user?.id ?? null,
    createdAt: parseInstant(reaction.createdAt),
  }));
}

function detailStubInput(
  entry: { id: string; identifier: string; title: string; stateId: string | null },
  teamId: string,
): IssueInput {
  return {
    id: entry.id,
    identifier: entry.identifier,
    number: 0,
    teamId,
    title: entry.title,
    description: null,
    url: null,
    branchName: null,
    priority: 0,
    estimate: null,
    stateId: entry.stateId,
    assigneeId: null,
    creatorId: null,
    projectId: null,
    milestoneId: null,
    cycleId: null,
    parentId: null,
    dueDate: null,
    sortOrder: 0,
    subIssueSortOrder: null,
    labelIds: [],
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    triagedAt: null,
    archivedAt: null,
    // A relation/parent selection does not carry the target's creation time.
    // Null is honest and prevents a directly opened stub from synthesizing a
    // false `created` timeline event from the source issue's timestamp.
    createdAt: null,
    // A real delta always supersedes a zero-version stub.
    updatedAt: 0,
  };
}

/**
 * A child arrives with four fields, not the whole issue.
 *
 * Rather than write a partial row that a later full fetch would have to
 * repair, a child that is **already in the mirror** is left alone and one that
 * is not gets a minimal row: enough to render "3 of 7 done" and to be
 * clickable, and honest about being a stub because every other column is empty
 * until the poller reaches it.
 */
function detailChildToNode(
  child: IssueDetailNode["children"]["nodes"][number],
  parent: IssueDetailNode,
): IssueNode {
  return {
    id: child.id,
    identifier: child.identifier,
    number: 0,
    title: child.title,
    description: null,
    url: "",
    branchName: "",
    priority: 0,
    estimate: null,
    dueDate: null,
    sortOrder: 0,
    subIssueSortOrder: null,
    labelIds: [],
    previousIdentifiers: [],
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    triagedAt: null,
    archivedAt: null,
    createdAt: parent.createdAt,
    // Zero, deliberately: the poller's watermark comparison then treats this
    // stub as older than anything real, so the next tick that touches the
    // child replaces it with the full row.
    updatedAt: new Date(0).toISOString(),
    team: parent.team,
    state: { id: child.state.id },
    assignee: null,
    creator: null,
    project: null,
    projectMilestone: null,
    cycle: null,
    parent: {
      id: parent.id,
      identifier: parent.identifier,
      title: parent.title,
    },
  };
}

/**
 * Projects, their milestones, and the bound teams' cycles.
 *
 * `startDate` and `targetDate` stay `TimelessDate` strings for the same reason
 * `dueDate` does: they are calendar facts, and converting one to epoch picks a
 * timezone on the user's behalf.
 *
 * `isActive` / `isNext` / `isPrevious` come straight from Linear. Deriving
 * them from `startsAt` and `endsAt` against the local clock reimplements the
 * team's cycle configuration badly and disagrees across a timezone.
 */
export function applyBreadth(store: Store, result: BreadthResult, at: number): void {
  const projects: ProjectRow[] = [];
  const links: { projectId: string; teamId: string }[] = [];
  const milestones: MilestoneRow[] = [];

  for (const node of result.projects.nodes) {
    projects.push({
      id: node.id,
      name: node.name,
      description: node.description,
      url: node.url,
      statusId: node.status?.id ?? null,
      leadId: node.lead?.id ?? null,
      startDate: node.startDate,
      targetDate: node.targetDate,
      progress: node.progress,
      updatedAt: parseInstant(node.updatedAt) ?? at,
    });
    for (const team of node.teams.nodes) {
      links.push({ projectId: node.id, teamId: team.id });
    }
    for (const milestone of node.projectMilestones.nodes) {
      milestones.push({
        id: milestone.id,
        projectId: node.id,
        name: milestone.name,
        targetDate: milestone.targetDate,
        sortOrder: milestone.sortOrder,
        updatedAt: parseInstant(milestone.updatedAt) ?? at,
      });
    }
  }

  store.putProjects(projects, links);
  store.putMilestones(milestones);

  const cycles: CycleRow[] = result.cycles.nodes.map((node) => ({
    id: node.id,
    teamId: node.team.id,
    number: node.number,
    name: node.name,
    startsAt: parseInstant(node.startsAt),
    endsAt: parseInstant(node.endsAt),
    isActive: node.isActive,
    isNext: node.isNext,
    isPrevious: node.isPrevious,
    updatedAt: parseInstant(node.updatedAt) ?? at,
  }));
  store.putCycles(cycles);
}

/**
 * Both directions, flattened into one table.
 *
 * `relations` is what this issue declares; `inverseRelations` is what
 * something else declares about it — and "blocked by" lives in the inverse
 * direction, which is the half a naive implementation misses. Storing both as
 * `(issueId → relatedIssueId, type)` from the *declaring* side means one query
 * answers "what blocks me" and "what do I block".
 */
export function applyRelations(store: Store, result: IssueRelationsResult): void {
  store.replaceRelations(
    result.issue.id,
    relationRowsFor(
      result.issue.id,
      result.issue.relations.nodes,
      result.issue.inverseRelations.nodes,
    ),
  );
}
