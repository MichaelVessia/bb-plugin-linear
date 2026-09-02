import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CommentView, DetailView, TimelineEntry } from "../src/contract.js";
import { safeRemoteMarkdown } from "../src/security-boundaries.js";
import { firstUnreadTimelineEntry } from "../src/select/timeline-unread.js";
import { safeHref } from "./href.js";
import { useLinearRpc } from "./rpc.js";

export function Timeline({
  detail,
  onReload,
  targetCommentId,
}: {
  detail: DetailView;
  onReload: () => void;
  targetCommentId?: string | null;
}) {
  const rpc = useLinearRpc();
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const timelineRef = useRef<HTMLElement>(null);
  const comments = useMemo(
    () => new Map(detail.comments.map((comment) => [comment.id, comment])),
    [detail.comments],
  );
  const entries = detail.activity.showActivity
    ? detail.timeline
    : detail.timeline.filter((entry) => entry.kind === "comment");
  const firstUnread = firstUnreadTimelineEntry(entries, comments, detail.unreadBoundaryAt);
  const targetAvailable =
    targetCommentId !== null &&
    targetCommentId !== undefined &&
    detail.comments.some(
      (comment) =>
        comment.id === targetCommentId ||
        comment.replies.some((reply) => reply.id === targetCommentId),
    );

  useEffect(() => {
    if (!targetAvailable || targetCommentId === null || targetCommentId === undefined) return;
    // Resolved threads expand in a child effect. Waiting one turn makes the
    // targeted reply exist before looking for it, without assuming that this
    // is the only issue pane mounted in bb.
    let highlightTimer: number | undefined;
    let targetElement: HTMLElement | undefined;
    const scrollTimer = window.setTimeout(() => {
      const wanted = `c-${targetCommentId}`;
      const target = Array.from(
        timelineRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [],
      )
        .find((element) => element.id === wanted);
      if (target === undefined) return;
      targetElement = target;
      target.scrollIntoView({ block: "center" });
      target.classList.add("bbl-comment-highlight");
      highlightTimer = window.setTimeout(
        () => target.classList.remove("bbl-comment-highlight"),
        2_000,
      );
    }, 0);
    return () => {
      window.clearTimeout(scrollTimer);
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
      targetElement?.classList.remove("bbl-comment-highlight");
    };
  }, [targetCommentId, targetAvailable]);

  const setVisibility = async () => {
    setVisibilityBusy(true);
    try {
      const result = await rpc.call("setActivityVisibility", {
        showActivity: !detail.activity.showActivity,
      });
      if (!result.ok) {
        toast.error("Activity visibility wasn't changed.");
        return;
      }
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Activity visibility wasn't changed.");
    } finally {
      setVisibilityBusy(false);
    }
  };

  const loadOlder = async () => {
    setOlderBusy(true);
    try {
      const result = await rpc.call("olderActivity", { issueId: detail.id });
      if (!result.ok) {
        toast.error("Older activity couldn't be loaded.");
      }
      onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Older activity couldn't be loaded.");
    } finally {
      setOlderBusy(false);
    }
  };

  return (
    <section ref={timelineRef} className="border-t border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground opacity-80">
          Activity
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={detail.activity.showActivity}
          disabled={visibilityBusy}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
          onClick={() => void setVisibility()}
        >
          <Icon
            name={detail.activity.showActivity ? "Eye" : "EyeOff"}
            className="size-3.5"
            aria-hidden
          />
          Show activity
        </button>
      </div>

      {detail.activity.hasOlder ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 h-7 px-2 text-xs text-muted-foreground"
          disabled={olderBusy}
          onClick={() => void loadOlder()}
        >
          {olderBusy ? <Icon name="Spinner" className="size-3.5" aria-hidden /> : null}
          Show older activity
        </Button>
      ) : null}

      <ol className="mt-3 space-y-3.5">
        {entries.map((entry) => {
          const key = entry.kind === "event" ? entry.id : entry.commentId;
          const comment = entry.kind === "comment" ? comments.get(entry.commentId) : undefined;
          if (entry.kind === "comment" && comment === undefined) return null;
          return (
            <TimelineRow
              key={key}
              entry={entry}
              comment={comment}
              unread={key === firstUnread}
              targetCommentId={targetCommentId ?? null}
            />
          );
        })}
      </ol>
    </section>
  );
}

function TimelineRow({
  entry,
  comment,
  unread,
  targetCommentId,
}: {
  entry: TimelineEntry;
  comment: CommentView | undefined;
  unread: boolean;
  targetCommentId: string | null;
}) {
  return (
    <li
      id={comment === undefined ? undefined : `c-${comment.id}`}
      className={comment === undefined ? undefined : "scroll-m-8 rounded-md p-1"}
    >
      {unread ? (
        <div className="mb-3 flex items-center gap-2" role="separator" aria-label="New activity">
          <span className="h-px flex-1 bg-primary opacity-50" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">New</span>
          <span className="h-px flex-1 bg-primary opacity-50" />
        </div>
      ) : null}
      {entry.kind === "event" ? (
        <EventRow entry={entry} />
      ) : comment !== undefined ? (
        <CommentThread comment={comment} targetCommentId={targetCommentId} />
      ) : null}
    </li>
  );
}

function EventRow({ entry }: { entry: Extract<TimelineEntry, { kind: "event" }> }) {
  const name = entry.actor?.name ?? entry.bot ?? "Linear";
  const initials = entry.actor?.initials ?? "◇";
  return (
    <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
      <Avatar
        initials={initials}
        name={name}
        bot={entry.actor === null}
      />
      <p className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{name}</span> {entry.text}
        {entry.detail === undefined ? null : (
          <span className="ml-1 opacity-70">{entry.detail}</span>
        )}
      </p>
      <time className="shrink-0 text-[10px] opacity-70" title={entry.atAbsolute}>
        {entry.atRelative}
      </time>
    </div>
  );
}

function CommentThread({
  comment,
  targetCommentId,
}: {
  comment: CommentView;
  targetCommentId: string | null;
}) {
  const targeted =
    targetCommentId === comment.id || comment.replies.some((reply) => reply.id === targetCommentId);
  const [expanded, setExpanded] = useState(!comment.resolved || targeted);
  useEffect(() => {
    if (targeted) setExpanded(true);
  }, [targeted]);
  const resolvedLabel =
    comment.resolvedBy === null ? "Resolved" : `Resolved by ${comment.resolvedBy}`;

  return (
    <>
      {comment.resolved ? (
        <button
          type="button"
          className="mb-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3" aria-hidden />
          {resolvedLabel}
        </button>
      ) : null}
      {expanded ? (
        <>
          <Comment comment={comment} />
          {comment.replies.length > 0 ? (
            <ol className="bbl-rail ml-3 mt-3 space-y-3 pl-3">
              {comment.replies.map((reply) => (
                <li
                  id={`c-${reply.id}`}
                  key={reply.id}
                  className="scroll-m-8 rounded-md p-1"
                >
                  <Comment comment={reply} />
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function Comment({ comment }: { comment: Omit<CommentView, "replies"> }) {
  const href = safeHref(comment.url);

  return (
    <div className="flex gap-2.5">
      <Avatar
        initials={comment.authorInitials}
        name={comment.author}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium text-foreground">{comment.author}</span>
          {comment.createdAtRelative !== null ? (
            <time
              className="shrink-0 text-[10px] text-muted-foreground opacity-70"
              title={comment.createdAtAbsolute ?? undefined}
            >
              {comment.createdAtRelative}
            </time>
          ) : null}
          {comment.edited ? (
            <span className="text-[10px] text-muted-foreground opacity-70">edited</span>
          ) : null}
          <CommentMenu comment={comment} href={href} />
        </div>

        <Markdown content={safeRemoteMarkdown(comment.body)} className="text-[13px]" />
        <ReactionChips reactions={comment.reactions} />
      </div>
    </div>
  );
}

function CommentMenu({
  comment,
  href,
}: {
  comment: Omit<CommentView, "replies">;
  href: string | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-6 shrink-0 text-muted-foreground"
          aria-label={`More actions for ${comment.author}'s comment`}
        >
          <Icon name="MoreHorizontal" className="size-3.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          disabled={comment.url === null}
          onSelect={() => {
            if (comment.url !== null) void navigator.clipboard?.writeText(comment.url);
          }}
        >
          <Icon name="Copy" className="size-3.5" aria-hidden />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {href === undefined ? (
          <DropdownMenuItem disabled>Open in Linear</DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <a href={href} target="_blank" rel="noreferrer">
              <Icon name="ExternalLink" className="size-3.5" aria-hidden />
              Open in Linear
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Avatar({
  initials,
  name,
  bot = false,
}: {
  initials: string;
  name: string;
  bot?: boolean;
}) {
  return (
    <span
      className="mt-0.5 grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-[9px] font-medium text-muted-foreground"
      title={name}
      aria-hidden
    >
      {bot ? (
        <Icon name="Zap" className="size-3" aria-hidden />
      ) : (
        initials
      )}
    </span>
  );
}

export function ReactionChips({ reactions }: { reactions: DetailView["reactions"] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 pt-1" aria-label="Reactions">
      {reactions.map((reaction) => (
        <span
          key={reaction.emoji}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
            reaction.mine
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground"
          }`}
          title={`${String(reaction.count)} reaction${reaction.count === 1 ? "" : "s"}`}
        >
          <span aria-hidden>{reaction.emoji}</span>
          <span className="tabular-nums">{reaction.count}</span>
        </span>
      ))}
    </div>
  );
}
