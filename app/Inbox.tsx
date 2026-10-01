import { useCallback, useEffect, useRef } from "react";
import { useBbNavigate, useRealtime } from "@bb/plugin-sdk/app";
import { toast } from "sonner";
import type { InboxItemView } from "../src/contract.js";
import { formatBadgeCount } from "../src/format.js";
import { InboxList } from "./InboxList.js";
import { useAsync, useLinearRpc } from "./rpc.js";

/**
 * The Inbox segment.
 *
 * This is a notification's **home**. The homepage section and the composer
 * banner are echoes of it, and nothing else carries a count.
 *
 * A row is unread until you open it here, mark it read, or read it in Linear.
 * Opening the segment does not mark anything read: when it did, every row was
 * read before you could act on it, and Mark read never appeared. A row stays
 * until it is dismissed, because a row disappearing under your cursor is worse
 * than a stale dot.
 *
 * Read and dismiss are bb's own state. The plugin keeps no Linear notification
 * id, so it cannot mark read, snooze or archive anything in Linear's inbox, and
 * the toolbar says so instead of offering those actions.
 */
export function InboxSegment() {
  const rpc = useLinearRpc();
  const navigate = useBbNavigate();

  const inbox = useAsync(
    useCallback(async () => rpc.call("inbox", {}), [rpc]),
    [],
  );
  useRealtime("linear:inbox", inbox.reload);

  const dismiss = useCallback(
    (keys: string[]) => {
      rpc
        .call("dismissInbox", { keys })
        .then(inbox.reload, (error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Couldn't dismiss.");
        });
    },
    [rpc, inbox.reload],
  );

  const markRead = useCallback(
    (keys: string[]) => {
      rpc
        .call("markInboxRead", { keys })
        .then(inbox.reload, (error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Couldn't mark read.");
        });
    },
    [rpc, inbox.reload],
  );

  const markAllRead = useCallback(() => {
    rpc
      .call("markInboxRead", { keys: [], all: true })
      .then(inbox.reload, (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Couldn't mark read.");
      });
  }, [rpc, inbox.reload]);

  const open = useCallback(
    (item: InboxItemView) => {
      if (item.unseen) markRead([item.key]);
      if (item.open.kind !== "issue") return;
      const issuePath = `i/${item.open.ref}`;
      navigate.toPluginPanel("linear", {
        subPath:
          item.open.commentId === null ? issuePath : `${issuePath}/c/${item.open.commentId}`,
      });
    },
    [navigate, markRead],
  );

  if (inbox.status === "loading") {
    return <p className="p-4 text-sm text-muted-foreground">Reading your Linear inbox…</p>;
  }
  if (inbox.status === "failed") {
    return <p className="p-4 text-sm text-destructive">{inbox.message}</p>;
  }

  const { items, unseen } = inbox.value;

  if (items.length === 0) {
    /* An empty inbox is a good outcome, so it says so and then teaches what
       would put something here — which is the difference between "nothing" and
       "nothing, and here is what you are watching for". */
    // Centred within the list's own measure, not across the whole pane — an
    // empty state that drifts to the middle of a wide panel has left the
    // control that produced it behind.
    return (
      <div className="flex w-full max-w-[56rem] flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-2 text-center">
          <p className="text-sm font-medium text-foreground">
            Nothing is waiting for you in Linear.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Assignments, replies, mentions and anything that blocks your work land here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <InboxList
      items={items}
      unreadTotal={unseen}
      actions={{ open, markRead, markAllRead, dismiss }}
    />
  );
}

/** The count on the segment label. Capped at 99+, because the difference
 *  between 100 and 340 has never changed anybody's next action. */
export function useInboxCount(): number {
  const rpc = useLinearRpc();
  const summary = useAsync(
    useCallback(async () => rpc.call("inboxSummary", null), [rpc]),
    [],
  );
  useRealtime("linear:inbox", summary.reload);

  /*
   * Rung 3 of the delivery ladder: the toast.
   *
   * **The backend never toasts.** It publishes `linear:inbox` and this is what
   * decides whether anything is shown — which is the only place that can,
   * because only the frontend knows whether the inbox is already on screen.
   *
   * Fires on a *rise* in the unseen count, never on the first load: mounting
   * the panel with four things already waiting is not four new events, and a
   * toast on mount is the fastest way to teach someone to ignore toasts. The
   * ref rather than state, so the comparison itself never causes a render.
   */
  const previous = useRef<number | null>(null);
  const ready = summary.status === "ready" ? summary.value : null;
  const unseen = ready?.unseen ?? 0;
  const newestText = ready?.newest?.text ?? null;
  const newestIdentifier = ready?.newest?.identifier ?? null;

  useEffect(() => {
    if (ready === null) return;
    const before = previous.current;
    previous.current = unseen;
    if (before === null || unseen <= before) return;

    const added = unseen - before;
    // The newest item names itself; anything more is counted. A stack of
    // toasts for one poll is one event rendered five times.
    toast(
      added === 1 && newestText !== null
        ? newestText
        : `${String(added)} new things in your Linear inbox`,
      added === 1 && newestIdentifier !== null ? { description: newestIdentifier } : undefined,
    );
    // `ready` is intentionally excluded: it is a fresh object on every poll,
    // and the effect must run on a change in the *count*, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseen]);

  return unseen;
}

export function InboxBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground tabular-nums">
      {formatBadgeCount(count)}
    </span>
  );
}
