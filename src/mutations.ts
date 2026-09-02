import { parseInstant } from "./format.js";
import { unwrapMutation } from "./linear/client.js";
import type { LinearClient } from "./linear/client.js";
import { isLinearError, refused } from "./linear/errors.js";
import type { CommentNode, IssueNode } from "./linear/types.js";
import type { CommentRow, ReactionRow } from "./store/rows.js";
import type { Store } from "./store/store.js";
import { toIssueInput } from "./sync/apply.js";

/**
 * The write path.
 *
 * Everything that changes something in Linear goes through here, and everything
 * here does the same four things in the same order — because doing three of
 * them is a bug that only shows up as a notification the user did not deserve,
 * or a panel that briefly disagrees with itself.
 *
 *   1. **Build the patch without ever using `labelIds`.**
 *   2. **Apply the returned entity optimistically**, so the panel is right
 *      before the next tick.
 *   3. **Record the echo before anything else can run**, so the tick sees its
 *      own write and stays silent.
 *   4. **Record a refusal** if the key turns out to be read-only, because
 *      Linear does not expose a key's scopes and this is the only way anyone
 *      finds out.
 */

export interface IssuePatch {
  readonly stateId?: string;
  readonly assigneeId?: string | null;
  readonly priority?: number;
  readonly estimate?: number | null;
  readonly projectId?: string | null;
  readonly cycleId?: string | null;
  readonly milestoneId?: string | null;
  readonly dueDate?: string | null;
  readonly title?: string;
  readonly description?: string;
  readonly parentId?: string | null;
  /** Label ids to add and remove, computed by the caller from the difference
   *  between what it read and what the user chose. */
  readonly addLabelIds?: readonly string[];
  readonly removeLabelIds?: readonly string[];
}

/**
 * Turn a patch into `IssueUpdateInput`, and never into a label replacement.
 *
 * `labelIds` replaces the **entire** set, so a patch built from a read taken
 * thirty seconds ago silently deletes whatever somebody added in between — and
 * the person who lost the label has no way to know it happened, because
 * nothing failed. `addedLabelIds` / `removedLabelIds` express the intent that
 * was actually formed.
 *
 * Pure, so the test can assert on the built variables rather than on a mocked
 * request.
 */
export function buildIssueUpdateInput(patch: IssuePatch): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  // `undefined` means "not part of this patch"; `null` means "clear it". The
  // distinction matters: unassigning an issue and not touching its assignee
  // are different intentions and both are expressible.
  if (patch.stateId !== undefined) input["stateId"] = patch.stateId;
  if (patch.assigneeId !== undefined) input["assigneeId"] = patch.assigneeId;
  if (patch.priority !== undefined) input["priority"] = patch.priority;
  if (patch.estimate !== undefined) input["estimate"] = patch.estimate;
  if (patch.projectId !== undefined) input["projectId"] = patch.projectId;
  if (patch.cycleId !== undefined) input["cycleId"] = patch.cycleId;
  if (patch.milestoneId !== undefined) input["projectMilestoneId"] = patch.milestoneId;
  if (patch.dueDate !== undefined) input["dueDate"] = patch.dueDate;
  if (patch.title !== undefined) input["title"] = patch.title;
  if (patch.description !== undefined) input["description"] = patch.description;
  if (patch.parentId !== undefined) input["parentId"] = patch.parentId;

  if (patch.addLabelIds !== undefined && patch.addLabelIds.length > 0) {
    input["addedLabelIds"] = [...patch.addLabelIds];
  }
  if (patch.removeLabelIds !== undefined && patch.removeLabelIds.length > 0) {
    input["removedLabelIds"] = [...patch.removeLabelIds];
  }

  return input;
}

export interface MutationDeps {
  /**
   * The client that can reach a given issue.
   *
   * A function rather than a client, because a Linear personal API key is
   * scoped to one workspace and this bb may hold several. Sending an issue id
   * over the wrong key does not leak anything — the key genuinely cannot see
   * it — but it does fail in the least informative way available, so the
   * lookup happens here rather than being got wrong at each call site.
   */
  readonly clientFor: (issueId: string) => LinearClient;
  readonly store: Store;
  readonly now: () => number;
  /** Called when Linear refuses a write for a permissions reason. The plugin
   *  has no other way to learn that a key is read-only. */
  readonly onWriteRefused?: (what: string) => void | Promise<void>;
  readonly publish?: () => void;
  readonly signal?: AbortSignal;
}

/**
 * Apply the returned entity, then record the echo.
 *
 * In that order, and both **synchronously before returning**, so a tick that
 * starts the instant this resolves already sees both. Echo suppression that
 * happens after the tick is echo suppression that loses the race.
 */
function absorbIssue(deps: MutationDeps, issue: IssueNode): void {
  const at = deps.now();
  const row = toIssueInput(issue);
  deps.store.putIssues([row], at);
  deps.store.recordEcho(row.id, row.updatedAt, at);
  deps.publish?.();
}

function absorbComment(deps: MutationDeps, comment: CommentNode, issueId: string): CommentRow {
  const at = deps.now();
  const row: CommentRow = {
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
  };
  deps.store.putComments([row]);
  deps.store.recordEcho(row.id, row.updatedAt, at);
  deps.publish?.();
  return row;
}

/**
 * Wrap a write so a permissions failure becomes the sentence the whole plugin
 * uses for it.
 *
 * A read-only key is discovered *by failure* and by nothing else: there is no
 * `apiKeys` or `viewerScopes` field to ask, and `teams` cannot even tell you
 * which teams a restricted key is restricted away from. So the first refusal
 * is the only evidence there will ever be, and it is recorded rather than
 * merely reported.
 */
async function write<T>(
  deps: MutationDeps,
  what: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isLinearError(error) && (error.code === "forbidden" || error.code === "unauthorized")) {
      await deps.onWriteRefused?.("this API key is read-only");
      throw refused(
        `${what} — this API key is read-only. Create a key with write permission in Linear and save it in the Linear API key field.`,
      );
    }
    throw error;
  }
}

export async function updateIssue(
  deps: MutationDeps,
  issueId: string,
  patch: IssuePatch,
  what: string,
): Promise<IssueNode> {
  const input = buildIssueUpdateInput(patch);
  if (Object.keys(input).length === 0) {
    throw refused("Nothing to change.");
  }

  return write(deps, what, async () => {
    const result = await deps.clientFor(issueId).updateIssue(issueId, input, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    const issue = unwrapMutation<IssueNode>(result.issueUpdate, "issue", what);
    absorbIssue(deps, issue);
    return issue;
  });
}

/**
 * Post a comment, with a client-generated id.
 *
 * The id makes the create idempotent: a deliberate retry after a network blip
 * resolves to the same comment rather than a second one. The transport never
 * retries a mutation on its own for exactly this reason — a blind retry of a
 * create is a duplicate — and this is what makes a considered retry safe.
 */
export async function postComment(
  deps: MutationDeps,
  input: { issueId: string; body: string; parentId?: string; clientId: string },
): Promise<CommentRow> {
  const trimmed = input.body.trim();
  if (trimmed === "") throw refused("A comment needs some text.");

  return write(deps, "Couldn't post that comment", async () => {
    const result = await deps.clientFor(input.issueId).createComment(
      {
        id: input.clientId,
        issueId: input.issueId,
        body: trimmed,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      },
      { initiator: "user", ...(deps.signal ? { signal: deps.signal } : {}) },
    );
    const comment = unwrapMutation<CommentNode>(
      result.commentCreate,
      "comment",
      "post that comment",
    );
    return absorbComment(deps, comment, input.issueId);
  });
}

/** Toggle one viewer reaction and mirror the answer before returning. */
export async function react(
  deps: MutationDeps,
  input: { issueId: string; commentId: string | null; emoji: string; viewerId: string },
): Promise<{ active: boolean; id: string }> {
  const emoji = input.emoji.trim();
  if (emoji === "") throw refused("A reaction needs an emoji.");
  if (input.commentId !== null) {
    const comment = deps.store.comment(input.commentId);
    if (comment === null || comment.issueId !== input.issueId) {
      throw refused("That comment isn't on this issue.");
    }
  }

  const existing = deps.store
    .reactionsFor(input.issueId)
    .find(
      (reaction) =>
        reaction.commentId === input.commentId &&
        reaction.emoji === emoji &&
        reaction.userId === input.viewerId,
    );
  if (existing !== undefined) {
    return write(deps, "Couldn't remove that reaction", async () => {
      const result = await deps.clientFor(input.issueId).deleteReaction(existing.id, {
        initiator: "user",
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      if (!result.reactionDelete.success) throw refused("Linear didn't remove that reaction.");
      const at = deps.now();
      deps.store.deleteReaction(existing.id);
      deps.store.recordEcho(existing.id, at, at);
      deps.publish?.();
      return { active: false, id: existing.id };
    });
  }

  return write(deps, "Couldn't add that reaction", async () => {
    const id = clientId();
    const result = await deps.clientFor(input.issueId).createReaction(
      {
        id,
        emoji,
        ...(input.commentId === null
          ? { issueId: input.issueId }
          : { commentId: input.commentId }),
      },
      { initiator: "user", ...(deps.signal ? { signal: deps.signal } : {}) },
    );
    const reaction = unwrapMutation<
      NonNullable<typeof result.reactionCreate.reaction>
    >(result.reactionCreate, "reaction", "add that reaction");
    const at = deps.now();
    const row: ReactionRow = {
      id: reaction.id,
      issueId: input.issueId,
      commentId: input.commentId,
      emoji: reaction.emoji,
      userId: reaction.user?.id ?? input.viewerId,
      createdAt: at,
    };
    deps.store.mergeReactions([row]);
    deps.store.recordEcho(row.id, at, at);
    deps.publish?.();
    return { active: true, id: row.id };
  });
}

/** Edit only a comment owned by the current workspace viewer. */
export async function editComment(
  deps: MutationDeps,
  input: { id: string; body: string; viewerId: string },
): Promise<CommentRow> {
  const existing = deps.store.comment(input.id);
  if (existing === null) throw refused("That comment isn't in the local copy.");
  if (existing.userId !== input.viewerId) {
    throw refused("Only your own comments can be edited.");
  }
  const body = input.body.trim();
  if (body === "") throw refused("A comment needs some text.");

  return write(deps, "Couldn't edit that comment", async () => {
    const result = await deps.clientFor(existing.issueId).updateComment(
      input.id,
      { body },
      { initiator: "user", ...(deps.signal ? { signal: deps.signal } : {}) },
    );
    const comment = unwrapMutation<CommentNode>(
      result.commentUpdate,
      "comment",
      "edit that comment",
    );
    return absorbComment(deps, comment, existing.issueId);
  });
}

/** Delete only a comment owned by the current viewer. Replies survive and are
 * made top-level by the store transaction. Human surfaces only: no agent tool
 * calls this function. */
export async function deleteComment(
  deps: MutationDeps,
  input: { id: string; viewerId: string },
): Promise<void> {
  const existing = deps.store.comment(input.id);
  if (existing === null) throw refused("That comment isn't in the local copy.");
  if (existing.userId !== input.viewerId) {
    throw refused("Only your own comments can be deleted.");
  }

  await write(deps, "Couldn't delete that comment", async () => {
    const result = await deps.clientFor(existing.issueId).deleteComment(input.id, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (!result.commentDelete.success) throw refused("Linear didn't delete that comment.");
    const at = deps.now();
    deps.store.deleteComment(input.id);
    deps.store.recordEcho(input.id, at, at);
    deps.publish?.();
  });
}

export async function setParent(
  deps: MutationDeps,
  input: { issueId: string; parentId: string | null },
): Promise<IssueNode> {
  return updateIssue(
    deps,
    input.issueId,
    { parentId: input.parentId },
    "Couldn't change that issue's parent",
  );
}

/**
 * Create an issue.
 *
 * The client-generated id makes this create-once: a deliberate retry after a
 * network blip resolves to the same issue rather than a second one, which is
 * the failure mode that makes people stop trusting a tracker integration.
 * `createIssue` goes out over the key that can see the *team*, which the
 * caller has already checked is in scope.
 */
export async function createIssue(
  deps: MutationDeps,
  clientForTeam: (teamId: string) => LinearClient,
  input: {
    teamId: string;
    title: string;
    description?: string;
    stateId?: string;
    assigneeId?: string;
    priority?: number;
    parentId?: string;
    labelIds?: readonly string[];
    clientId: string;
  },
): Promise<IssueNode> {
  const title = input.title.trim();
  if (title === "") throw refused("An issue needs a title.");

  return write(deps, "Couldn't create that issue", async () => {
    const result = await clientForTeam(input.teamId).createIssue(
      {
        id: input.clientId,
        teamId: input.teamId,
        title,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
        ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        // The one place `labelIds` is correct: there is no prior set to
        // clobber on a create.
        ...(input.labelIds === undefined ? {} : { labelIds: [...input.labelIds] }),
      },
      { initiator: "user", ...(deps.signal ? { signal: deps.signal } : {}) },
    );
    const issue = unwrapMutation<IssueNode>(result.issueCreate, "issue", "create that issue");
    absorbIssue(deps, issue);
    return issue;
  });
}

/** Relate two issues. Direction is carried by which id goes where. */
export async function relateIssues(
  deps: MutationDeps,
  input: { issueId: string; relatedIssueId: string; type: string },
): Promise<void> {
  await write(deps, "Couldn't relate those issues", async () => {
    const result = await deps.clientFor(input.issueId).createRelation(input, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    const relation = unwrapMutation<
      NonNullable<typeof result.issueRelationCreate.issueRelation>
    >(
      result.issueRelationCreate,
      "issueRelation",
      "relate those issues",
    );
    const issueId = relation.issue?.id ?? input.issueId;
    const relatedIssueId = relation.relatedIssue?.id ?? input.relatedIssueId;
    deps.store.mergeRelations([{
      id: relation.id,
      issueId,
      relatedIssueId,
      type: relation.type,
    }]);
    const at = deps.now();
    deps.store.recordEcho(relation.id, at, at);
    deps.publish?.();
  });
}

/** Remove a relation by its mirrored id. Human surfaces only. */
export async function unrelate(
  deps: MutationDeps,
  input: { relationId: string },
): Promise<void> {
  const relation = deps.store.relation(input.relationId);
  if (relation === null) throw refused("That relation isn't in the local copy.");
  await write(deps, "Couldn't remove that relation", async () => {
    const result = await deps.clientFor(relation.issueId).deleteRelation(input.relationId, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (!result.issueRelationDelete.success) {
      throw refused("Linear didn't remove that relation.");
    }
    const at = deps.now();
    deps.store.deleteRelation(input.relationId);
    deps.store.recordEcho(input.relationId, at, at);
    deps.publish?.();
  });
}

/** Link a URL to an issue — richly, where Linear recognises the host. */
export async function attachUrl(
  deps: MutationDeps,
  input: { issueId: string; url: string; title: string | null },
): Promise<{ alreadyThere: boolean }> {
  return write(deps, "Couldn't attach that link", async () => {
    const owner = deps.clientFor(input.issueId);
    const existing = await owner.attachmentsForUrl(input.url, { initiator: "user" });
    if (
      existing.attachmentsForURL.nodes.some(
        (attachment) => attachment.issue?.id === input.issueId,
      )
    ) return { alreadyThere: true };

    const result = await owner.linkUrl(input, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    const attachment = unwrapMutation<
      NonNullable<typeof result.attachmentLinkURL.attachment>
    >(
      result.attachmentLinkURL,
      "attachment",
      "attach that link",
    );
    if (attachment.url !== null) {
      const at = deps.now();
      const updatedAt = parseInstant(attachment.updatedAt) ?? at;
      deps.store.mergeAttachments([{
        id: attachment.id,
        issueId: input.issueId,
        title: attachment.title ?? input.title ?? attachment.url,
        subtitle: attachment.subtitle,
        url: attachment.url,
        sourceType: attachment.sourceType,
        groupBySource: attachment.groupBySource,
        createdAt: parseInstant(attachment.createdAt),
        updatedAt,
        creatorId: attachment.creator?.id ?? null,
      }]);
      deps.store.recordEcho(attachment.id, updatedAt, at);
    }
    deps.publish?.();
    return { alreadyThere: false };
  });
}

/**
 * Archive an issue — reversible, and never `issueDelete`.
 *
 * The local row is marked archived immediately rather than removed: an archived
 * issue is still real, still linkable, and still what a thread was started
 * from. Deleting the row locally would break every one of those.
 */
export async function archiveIssue(deps: MutationDeps, issueId: string): Promise<void> {
  await write(deps, "Couldn't archive that issue", async () => {
    const result = await deps.clientFor(issueId).archiveIssue(issueId, {
      initiator: "user",
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (result.issueArchive.success === false) {
      throw refused("Linear didn't archive that issue.");
    }
    const at = deps.now();
    const existing = deps.store.issue(issueId);
    if (existing !== null) {
      deps.store.putIssues([{ ...existing, archivedAt: at, updatedAt: at }], at);
      deps.store.recordEcho(issueId, at, at);
    }
    deps.publish?.();
  });
}

/**
 * A client-generated UUID for create-once semantics.
 *
 * `crypto.randomUUID` is available in every runtime this plugin targets; the
 * fallback exists so a stray environment without it degrades to a
 * still-unique-enough id rather than throwing inside a mutation.
 */
export function clientId(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
}
