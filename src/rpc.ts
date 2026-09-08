/**
 * The rpc surface this plugin currently ships.
 *
 * Deliberately slim: the old panel's 24-method contract was cut with the
 * panel, and each new surface adds its methods here as it lands —
 * schema-first, so the wire boundary is validated in both directions from
 * day one. Detail shapes are reused from `contract.ts` rather than re-drawn,
 * because the projections that build them (`select/detail.ts`) are shared.
 */

import { z } from "zod";
import {
  rpcContract as legacyContract,
  stateOptionSchema,
  glyphSpecSchema,
  toneSchema,
} from "./contract.js";
import { defineRpcContract } from "./sdk-runtime.js";
import { WORK_ACTIONS } from "./store/thread-work.js";
import { THREAD_ISSUES_MAX } from "./thread-issues.js";

export const workIssueSchema = z.object({
  issueId: z.string(), identifier: z.string(), title: z.string(),
  stateName: z.string(), tone: toneSchema, glyph: glyphSpecSchema,
  url: z.string().nullable(), origin: z.enum(["spawn", "manual", "branch", "message"]),
  provenance: z.string().nullable(),
});

/** What the header chip and the side panel both know about a thread. */
export const threadIssueSchema = z.object({
  active: z.array(workIssueSchema).default([]),
  activeCount: z.number().int().nonnegative().default(0),
  history: z.array(workIssueSchema).default([]),
  historyCount: z.number().int().nonnegative().default(0),
  revision: z.number().int().nonnegative().default(0),
  /** The bound issue, or null when the thread is unbound. */
  binding: z
    .object({
      issueId: z.string(),
      identifier: z.string(),
      title: z.string(),
      stateName: z.string(),
      tone: toneSchema,
      glyph: glyphSpecSchema,
      url: z.string().nullable(),
      /** How the binding was made — shown so trust is inspectable. */
      origin: z.enum(["spawn", "manual", "branch", "message"]),
      /** Which message or branch produced the binding, human-readable — e.g.
       *  `the opening user message ("otto-2222")`. Null when the origin
       *  carries its own story or the row predates provenance. */
      provenance: z.string().nullable(),
      stateOptions: z.array(stateOptionSchema),
    })
    .nullable(),
  /** The suggestion rungs' candidate, or null. Never set while bound. */
  suggestion: z
    .object({
      issueId: z.string(),
      identifier: z.string(),
      title: z.string(),
    })
    .nullable(),
  /** Other in-scope issues the user's messages named. While bound these are
   *  offered instead of silently re-binding; while unbound they trail the
   *  primary suggestion. */
  alternates: z
    .array(
      z.object({
        issueId: z.string(),
        identifier: z.string(),
        title: z.string(),
      }),
    )
    .default([]),
});
export type ThreadIssue = z.infer<typeof threadIssueSchema>;

export const serverRpcContract = defineRpcContract({
  /** The settings card and homepage section: who is connected, per slot. */
  status: {
    input: z.null(),
    output: z.object({
      configured: z.boolean(),
      accounts: z.array(
        z.object({
          slot: z.string(),
          label: z.string(),
          orgName: z.string().nullable(),
          orgUrlKey: z.string().nullable(),
          displayName: z.string().nullable(),
          error: z.string().nullable(),
        }),
      ),
    }),
  },

  /* ── M3: the thread's issue ──────────────────────────────────────────── */

  threadIssue: {
    input: z.object({ threadId: z.string() }),
    output: threadIssueSchema,
  },

  /**
   * Many threads at once, from the mirror only — for another plugin's
   * sidebar. Unlike `threadIssue`, asking never starts an evaluation, so
   * two hundred rows cost two hundred row reads and no Linear calls. Ids
   * past the cap are left out of the answer rather than rejected.
   */
  threadIssues: {
    input: z.object({ threadIds: z.array(z.string()).max(THREAD_ISSUES_MAX) }),
    output: z.object({
      threads: z.record(
        z.string(),
        z.object({
          active: z.array(workIssueSchema).default([]),
          activeCount: z.number().int().nonnegative().default(0),
          binding: z
            .object({
              issueId: z.string(),
              identifier: z.string(),
              title: z.string(),
              stateName: z.string(),
              tone: toneSchema,
              glyph: glyphSpecSchema,
              url: z.string().nullable(),
              origin: z.enum(["spawn", "manual", "branch", "message"]),
              provenance: z.string().nullable(),
            })
            .nullable(),
          suggestion: z
            .object({ issueId: z.string(), identifier: z.string(), title: z.string() })
            .nullable(),
        }),
      ),
    }),
  },

  /** Bind manually (issueId set) or unbind (issueId null). Accepting a
   *  suggestion routes through here too — the accept click IS a manual
   *  binding, and its provenance says so. */
  bindThread: {
    input: z.object({ threadId: z.string(), issueId: z.string().nullable() }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },

  updateThreadWork: {
    input: z.object({ threadId: z.string(), action: z.enum(WORK_ACTIONS),
      issue: z.string().min(1).nullable(), expectedRevision: z.number().int().nonnegative().optional() }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },

  /* ── The issue pane, on the legacy shapes ────────────────────────────── */
  /*
   * Lifted verbatim from the predecessor's contract so its Detail and
   * Editors components port unchanged: same method names, same schemas, same
   * undefined-means-untouched / null-means-clear patch semantics, same
   * add/remove label discipline (never a replacement set).
   */
  issue: legacyContract.issue,
  setActivityVisibility: legacyContract.setActivityVisibility,
  olderActivity: legacyContract.olderActivity,
  updateIssue: legacyContract.updateIssue,
  editorOptions: legacyContract.editorOptions,
  comment: legacyContract.comment,
  react: legacyContract.react,
  editComment: legacyContract.editComment,
  deleteComment: legacyContract.deleteComment,
  setParent: legacyContract.setParent,
  unrelate: legacyContract.unrelate,
  relate: legacyContract.relate,
  attachLink: legacyContract.attachLink,
  searchIssuesForPicker: legacyContract.searchIssuesForPicker,
  mentionCandidates: legacyContract.mentionCandidates,

  /* ── M4: the nav panel, on the legacy shapes ─────────────────────────── */
  /*
   * Same lift, same reason: the grouped-list projections (`select/panel.ts`,
   * `panel.ts`) and the views over them port unchanged. The panel reads the
   * mirror and never waits on Linear — `panel` is the one rpc a sidebar
   * paints from.
   */
  connection: legacyContract.connection,
  workspaces: legacyContract.workspaces,
  refreshWorkspace: legacyContract.refreshWorkspace,
  panel: legacyContract.panel,
  facets: legacyContract.facets,
  workingSet: legacyContract.workingSet,
  preferences: legacyContract.preferences,
  setSort: legacyContract.setSort,
  bindings: legacyContract.bindings,
  bind: legacyContract.bind,
  unbind: legacyContract.unbind,
  resolveIdentifiers: legacyContract.resolveIdentifiers,
  archiveIssue: legacyContract.archiveIssue,
  createTargets: legacyContract.createTargets,
  createIssue: legacyContract.createIssue,
  startThread: legacyContract.startThread,
  inbox: legacyContract.inbox,
  inboxSummary: legacyContract.inboxSummary,
  dismissInbox: legacyContract.dismissInbox,
});
