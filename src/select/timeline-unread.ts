import type { CommentView, TimelineEntry } from "../contract.js";

/** The timeline key before which the single unread divider belongs. */
export function firstUnreadTimelineEntry(
  entries: readonly TimelineEntry[],
  comments: ReadonlyMap<string, CommentView>,
  boundary: number | null,
): string | null {
  if (boundary === null) return null;
  for (const entry of entries) {
    const at =
      entry.kind === "event"
        ? entry.at
        : latestCommentTime(comments.get(entry.commentId));
    if (at !== null && at > boundary) {
      return entry.kind === "event" ? entry.id : entry.commentId;
    }
  }
  return null;
}

function latestCommentTime(comment: CommentView | undefined): number | null {
  if (comment === undefined) return null;
  const times = [comment.createdAt, ...comment.replies.map((reply) => reply.createdAt)].filter(
    (at): at is number => at !== null,
  );
  return times.length === 0 ? null : Math.max(...times);
}
