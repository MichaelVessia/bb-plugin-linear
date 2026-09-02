import type { LinearClient } from "./linear/client.js";
import type { Store } from "./store/store.js";
import { applyIssueActivityPage } from "./sync/apply.js";
import { z } from "zod";
import { KV, type VersionedStore } from "./kv.js";

const activityVisibilitySchema = z.object({ v: z.literal(1), showActivity: z.boolean() });
const lastOpenedSchema = z.object({
  v: z.literal(1),
  at: z.number(),
  boundary: z.number().nullable().optional(),
});
const lastOpenedIndexSchema = z.object({ v: z.literal(1), ids: z.array(z.string()) });
export const LAST_OPENED_LIMIT = 500;
// Re-renders and mirror publishes belong to the same pane-open session. Ten
// minutes is long enough for an ordinary read while still advancing the next
// genuine visit even if the panel was left mounted in the background.
export const PANE_OPEN_SESSION_MS = 10 * 60_000;

/** Read the previous boundary before advancing it, then keep KV bounded. */
export async function readPanePreferences(input: {
  readonly kv: VersionedStore;
  readonly issueId: string;
  readonly now: () => number;
  readonly advanceOpened: boolean;
}): Promise<{ lastOpenedAt: number | null; showActivity: boolean }> {
  const [opened, activity] = await Promise.all([
    input.kv.readOptional(KV.lastOpened(input.issueId), lastOpenedSchema),
    input.kv.readOptional(KV.activityVisibility, activityVisibilitySchema),
  ]);
  const currentTime = input.now();
  const continuingSession =
    input.advanceOpened &&
    opened?.boundary !== undefined &&
    currentTime - opened.at <= PANE_OPEN_SESSION_MS;
  let boundary = opened?.boundary ?? opened?.at ?? null;
  if (input.advanceOpened && !continuingSession) {
    boundary = opened?.at ?? null;
    const current = await input.kv.read(
      KV.lastOpenedIndex,
      lastOpenedIndexSchema,
      { v: 1 as const, ids: [] },
    );
    const ids = [...current.ids.filter((id) => id !== input.issueId), input.issueId];
    const dropped = ids.splice(0, Math.max(0, ids.length - LAST_OPENED_LIMIT));
    await Promise.all([
      input.kv.write(KV.lastOpened(input.issueId), {
        v: 1,
        at: currentTime,
        boundary,
      }),
      input.kv.write(KV.lastOpenedIndex, { v: 1, ids }),
      ...dropped.map((id) => input.kv.remove(KV.lastOpened(id))),
    ]);
  }
  return {
    lastOpenedAt: boundary,
    showActivity: activity?.showActivity ?? true,
  };
}

/** Fetch and write through one older page after the caller has checked scope. */
export async function loadOlderActivity(input: {
  readonly issueId: string;
  readonly store: Store;
  readonly client: LinearClient;
  readonly now: () => number;
  readonly signal?: AbortSignal;
  readonly debug?: (message: string) => void;
}): Promise<{ ok: boolean; hasOlder: boolean }> {
  const cursor = input.store.activityCursor(input.issueId);
  if (
    cursor === null ||
    cursor.direction !== "after" ||
    (!cursor.commentsMore && !cursor.historyMore)
  ) {
    return { ok: true, hasOlder: false };
  }
  const page = await input.client.issueActivityPage(
    input.issueId,
    {
      commentsAfter: cursor.commentsCursor,
      historyAfter: cursor.historyCursor,
    },
    {
      initiator: "user",
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  if (page.issue.id !== input.issueId) return { ok: false, hasOlder: true };
  applyIssueActivityPage(input.store, page, input.now(), {
    debug: input.debug,
    commentsActive: cursor.commentsMore,
    historyActive: cursor.historyMore,
  });
  const next = input.store.activityCursor(input.issueId);
  return {
    ok: true,
    hasOlder: next?.commentsMore === true || next?.historyMore === true,
  };
}
