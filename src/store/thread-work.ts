import type { Database } from "better-sqlite3";
import type { ThreadLinkRow } from "./rows.js";

export const WORK_ACTIONS = ["start", "add", "focus", "finish", "remove", "clear"] as const;
export type WorkAction = (typeof WORK_ACTIONS)[number];
export interface WorkRow extends ThreadLinkRow {
  readonly status: "active" | "previous" | "removed";
  readonly updatedAt: number;
}
export interface WorkState {
  readonly revision: number;
  readonly afterSequence: number;
  readonly managed: boolean;
  readonly candidates: readonly string[];
}
export interface WorkChange {
  readonly threadId: string;
  readonly action: WorkAction;
  readonly issue?: ThreadLinkRow;
  readonly now: number;
  readonly expectedRevision?: number;
  /** Only the initial branch/message discovery is automatic. */
  readonly automatic?: boolean;
}
export interface WorkResult { readonly ok: boolean; readonly message: string | null }

const columns = `thread_id AS threadId, issue_id AS issueId, team_id AS teamId,
  project_id AS projectId, created_at AS createdAt, updated_at AS updatedAt,
  origin, provenance, status`;

/** Atomic local work state. No Linear calls or workflow-state writes. */
export function createThreadWorkStore(db: Database) {
  function threadWorkState(threadId: string): WorkState {
    const row = db.prepare(`SELECT revision, after_sequence AS afterSequence, managed, candidates
      FROM thread_work_state WHERE thread_id = ?`).get(threadId) as
      | { revision: number; afterSequence: number; managed: number; candidates: string }
      | undefined;
    if (!row) return { revision: 0, afterSequence: 0, managed: false, candidates: [] };
    const candidates: unknown = JSON.parse(row.candidates);
    return { ...row, managed: row.managed === 1,
      candidates: Array.isArray(candidates) ? candidates.filter((id): id is string => typeof id === "string").slice(0, 3) : [] };
  }

  function threadWork(threadId: string): WorkRow[] {
    return db.prepare(`SELECT ${columns} FROM thread_work WHERE thread_id = ?
      ORDER BY updated_at DESC, issue_id`).all(threadId) as WorkRow[];
  }

  const changeThreadWork = db.transaction((input: WorkChange): WorkResult => {
    const state = threadWorkState(input.threadId);
    if (input.expectedRevision !== undefined && state.revision !== input.expectedRevision) {
      return { ok: false, message: "Thread work changed. Refresh and try again." };
    }
    const issue = input.issue;
    if (input.action !== "clear" && (!issue || issue.threadId !== input.threadId)) {
      return { ok: false, message: "Choose an issue for this work operation." };
    }
    const rows = threadWork(input.threadId);
    const existing = rows.find((row) => row.issueId === issue?.issueId);
    if (["focus", "finish", "remove"].includes(input.action) && !existing) {
      return { ok: false, message: "That issue is not linked to this thread." };
    }
    if (input.action === "focus" && existing?.status !== "active") {
      return { ok: false, message: "Resume this issue with Add or Start before focusing it." };
    }
    if (input.action === "finish" && existing?.status !== "active") {
      return { ok: true, message: "This issue is already inactive here." };
    }
    if ((input.action === "add" || input.action === "start") &&
        existing?.status !== "active" && rows.filter((row) => row.status === "active").length >= 20 && input.action !== "start") {
      return { ok: false, message: "This thread already has 20 active issues. Finish or remove one first." };
    }
    const current = db.prepare(`SELECT issue_id AS issueId FROM thread_link WHERE thread_id = ?`)
      .get(input.threadId) as { issueId: string } | undefined;
    if (input.action === "start" || input.action === "clear") {
      db.prepare(`UPDATE thread_work SET status = 'previous', updated_at = ?
        WHERE thread_id = ? AND status = 'active' AND issue_id != ?`)
        .run(input.now, input.threadId, issue?.issueId ?? "");
    }
    if (issue && (input.action === "start" || input.action === "add")) {
      db.prepare(`INSERT INTO thread_work (thread_id, issue_id, team_id, project_id,
          created_at, updated_at, origin, provenance, status)
        VALUES (@threadId, @issueId, @teamId, @projectId, @createdAt, @updatedAt, @origin, @provenance, 'active')
        ON CONFLICT(thread_id, issue_id) DO UPDATE SET status = 'active',
          updated_at = excluded.updated_at, team_id = excluded.team_id, project_id = excluded.project_id,
          origin = excluded.origin, provenance = excluded.provenance`)
        .run({ ...issue, provenance: issue.provenance ?? null, updatedAt: input.now });
    }
    if (issue && ["finish", "remove", "focus"].includes(input.action)) {
      db.prepare(`UPDATE thread_work SET status = ?, updated_at = ? WHERE thread_id = ? AND issue_id = ?`)
        .run(input.action === "finish" ? "previous" : input.action === "remove" ? "removed" : "active",
          input.now, input.threadId, issue.issueId);
    }
    const active = threadWork(input.threadId).filter((row) => row.status === "active");
    const focusId = input.action === "start" || input.action === "focus"
      ? issue?.issueId : current?.issueId;
    const focus = active.find((row) => row.issueId === focusId) ?? active[0];
    db.prepare(`DELETE FROM thread_link WHERE thread_id = ?`).run(input.threadId);
    if (focus) {
      db.prepare(`INSERT INTO thread_link (thread_id, issue_id, team_id, project_id, created_at, origin, provenance)
        VALUES (@threadId, @issueId, @teamId, @projectId, @createdAt, @origin, @provenance)`)
        .run({ ...focus, provenance: focus.provenance ?? null });
    }
    db.prepare(`INSERT INTO thread_work_state (thread_id, revision, managed) VALUES (?, 1, ?)
      ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1,
        managed = MAX(managed, excluded.managed), candidates = '[]'`)
      .run(input.threadId, input.automatic ? 0 : 1);
    return { ok: true, message: "Thread work updated." };
  });

  return {
    threadWorkState,
    threadWork,
    changeThreadWork,
    threadWorkByThreadIds(threadIds: readonly string[]): WorkRow[] {
      if (!threadIds.length) return [];
      return db.prepare(`SELECT ${columns} FROM thread_work
        WHERE thread_id IN (${threadIds.map(() => "?").join(",")}) AND status = 'active'
        ORDER BY updated_at DESC, issue_id`).all(...threadIds) as WorkRow[];
    },
    saveThreadEvidence(threadId: string, afterSequence: number, candidates: readonly string[], expectedRevision: number): boolean {
      return db.transaction(() => {
        if (threadWorkState(threadId).revision !== expectedRevision) return false;
        db.prepare(`INSERT INTO thread_work_state (thread_id, after_sequence, candidates) VALUES (?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET after_sequence = MAX(after_sequence, excluded.after_sequence),
            candidates = excluded.candidates`).run(threadId, afterSequence, JSON.stringify(candidates.slice(0, 3)));
        return true;
      })();
    },
    deleteThreadWork(threadId: string): void {
      db.transaction(() => {
        for (const table of ["thread_link", "thread_work", "thread_work_state"]) {
          db.prepare(`DELETE FROM ${table} WHERE thread_id = ?`).run(threadId);
        }
      })();
    },
  };
}

export type ThreadWorkStore = ReturnType<typeof createThreadWorkStore>;
