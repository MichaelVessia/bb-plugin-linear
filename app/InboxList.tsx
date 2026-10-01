import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { InboxItemView } from "../src/contract.js";
import { safeHref } from "./href.js";

export interface InboxActions {
  open: (item: InboxItemView) => void;
  markRead: (keys: string[]) => void;
  dismiss: (keys: string[]) => void;
}

/**
 * The Inbox rows and the toolbar above them, with no host hooks, so tests can
 * render exactly what the user gets.
 *
 * Every action is always visible. Hover-revealed controls were invisible on a
 * touch screen and easy to miss everywhere else, and they hid the only way to
 * mark a row read. The toolbar sits above the list, not below it, so a list
 * taller than the panel can never push the bulk actions out of view.
 */
export function InboxList({
  items,
  actions,
}: {
  items: readonly InboxItemView[];
  actions: InboxActions;
}) {
  const unread = items.filter((item) => item.unseen);
  const read = items.filter((item) => !item.unseen);

  return (
    <div className="bbl-inbox flex min-h-0 w-full max-w-[56rem] flex-1 flex-col">
      <div className="space-y-1 border-b border-border px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">
            {unread.length === 0 ? "All read" : `${String(unread.length)} unread`}
          </span>
          {unread.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.markRead(unread.map((item) => item.key))}
            >
              Mark all read
            </Button>
          ) : null}
          {read.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => actions.dismiss(read.map((item) => item.key))}
            >
              {`Dismiss ${String(read.length)} read`}
            </Button>
          ) : null}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Mark read and Dismiss change bb only. Linear&apos;s own inbox does not change: to mark
          read, snooze or unsubscribe there, open the notification in Linear.
        </p>
      </div>

      <ul className="bbl-scroller min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {items.map((item) => (
          <InboxItemRow key={item.key} item={item} actions={actions} />
        ))}
      </ul>
    </div>
  );
}

function InboxItemRow({ item, actions }: { item: InboxItemView; actions: InboxActions }) {
  const linearHref = item.open.kind === "issue" ? safeHref(item.url) : undefined;

  return (
    <li className="group flex items-center gap-2 rounded-md py-1 pl-2 pr-1 hover:bg-state-hover">
      {/* Unseen rows carry a dot. The space is reserved either way, so
          rows do not shift horizontally as they are read. */}
      <span
        className={`size-1.5 shrink-0 rounded-full ${item.unseen ? "bg-primary" : "bg-transparent"}`}
        aria-hidden
      />

      <InboxItemLabel item={item} onOpen={actions.open} />

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {item.age}
      </span>

      <span className="flex shrink-0 items-center">
        {item.unseen ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-xs"
            aria-label={`Mark read in bb: ${item.text}`}
            onClick={() => actions.markRead([item.key])}
          >
            <Icon name="Check" className="size-3.5" aria-hidden />
            <span className="bbl-inbox-action-label">Mark read</span>
          </Button>
        ) : null}
        {linearHref !== undefined ? (
          <Button variant="ghost" size="sm" className="h-6 px-1.5" asChild>
            <a
              href={linearHref}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open in Linear: ${item.text}`}
              title="Open in Linear"
            >
              <Icon name="ExternalLink" className="size-3.5" aria-hidden />
            </a>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          aria-label={`Dismiss from bb: ${item.text}`}
          onClick={() => actions.dismiss([item.key])}
        >
          <Icon name="CircleX" className="size-3.5" aria-hidden />
          <span className="bbl-inbox-action-label">Dismiss</span>
        </Button>
      </span>
    </li>
  );
}

/**
 * The row's text, as the control its open target allows: an issue bb reads
 * opens here, anything else opens Linear, and a row with neither is text.
 */
function InboxItemLabel({
  item,
  onOpen,
}: {
  item: InboxItemView;
  onOpen: (item: InboxItemView) => void;
}) {
  const content = (
    <>
      {/* Weight rather than colour carries "unread": a muted row is
          already how everything else says "less important", and using
          it twice makes neither reading reliable. */}
      <span className={item.unseen ? "font-medium text-foreground" : "text-muted-foreground"}>
        {item.text}
      </span>
      {/* Only present with a second workspace connected — a merged
          inbox without labels is a guessing game, and labels on a
          single workspace are noise. */}
      {item.workspace !== null ? (
        <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
          {item.workspace}
        </span>
      ) : null}
    </>
  );
  const className = "min-w-0 flex-1 truncate text-left text-[13px]";

  if (item.open.kind === "issue") {
    return (
      <button type="button" className={className} onClick={() => onOpen(item)}>
        {content}
      </button>
    );
  }
  const href = item.open.kind === "linear" ? safeHref(item.open.url) : undefined;
  if (href !== undefined) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={className}
        title="Not in a team bb reads. Opens in Linear."
        onClick={() => onOpen(item)}
      >
        {content}
        <Icon
          name="ExternalLink"
          className="ml-1 inline size-3 align-[-1px] text-muted-foreground"
          aria-hidden
        />
        <span className="sr-only"> (opens in Linear)</span>
      </a>
    );
  }
  return <span className={className}>{content}</span>;
}
