/**
 * The binding ladder: which Linear issue is this bb thread working on?
 *
 * Five rungs, strongest first, and the strength ordering is the design:
 *
 *   1. **An existing link** — a spawn, a manual `bb linear link`, or a rung
 *      below that already persisted. Ground truth; never re-litigated here.
 *      A later user message naming a *different* issue never re-binds — it
 *      surfaces as an alternate the user can act on.
 *   2. **The branch name** — Linear generated it (`gitBranchFormat`), bb
 *      checked it out, and the mirror indexes it. Deterministic, auto-binds.
 *   2.5 **An issue key in a hand-edited branch** — when the branch no longer
 *      byte-matches Linear's stored branch name, its explicit key still names
 *      the issue. Deterministic and scope-checked, auto-binds.
 *   3. **An issue key in a USER message** — "fix otto-2222" names its issue.
 *      Deterministic when the key resolves in scope, auto-binds — and only
 *      user-authored text qualifies. Assistant and tool output names every
 *      issue it *researched* (an old PR's ticket, a related regression), which
 *      is exactly the text that once bound a thread to the wrong issue. The
 *      caller enforces the provenance; this file documents the contract.
 *      The first key in the opening message wins; every other in-scope key
 *      the user named becomes an alternate suggestion.
 *   3.5 **An issue key in the thread's title** — never binds, because a bb
 *      title's authorship is unknowable: bb generates titles from model
 *      output and agents rename threads. A key there is a strong *suggestion*.
 *   4. **A fuzzy title match** — never binds. It becomes a *suggestion* the
 *      user confirms with one click, because a wrong binding combined with
 *      write-back moves the wrong ticket, and the suggestion UI makes being
 *      wrong cost one glance instead of one incident.
 *
 * Pure: every dependency is injected, every outcome is a value. The caller
 * persists deterministic outcomes (rungs 2–3) and caches suggestions.
 */

import { identifiersInText } from "./select/identifiers.js";
import { identifierFromBranch } from "./git/remote.js";
import type { IssueRow, ThreadLinkOrigin, ThreadLinkRow } from "./store/rows.js";

export interface LadderIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly teamId: string;
}

export interface LadderDeps {
  threadLink(threadId: string): ThreadLinkRow | null;
  issuesByBranch(branchName: string): IssueRow[];
  issueByIdentifier(identifier: string): IssueRow | null;
  /** Open issues of the readable teams, for the fuzzy rung. Bounded by the
   *  caller — the scorer is O(candidates). */
  openIssues(): readonly LadderIssue[];
  /** The thread's readable team ids; an issue outside them never binds. */
  readTeamIds: ReadonlySet<string>;
}

/** A user-authored text worth scanning for issue keys. */
export interface LadderMessage {
  readonly text: string;
  /** Which surface carried the text, for provenance — e.g. "the opening user
   *  message". User-authored surfaces ONLY: the caller must never put
   *  assistant or tool text here. */
  readonly label: string;
}

export interface LadderInput {
  readonly threadId: string;
  readonly branchName: string | null;
  /** User-authored texts only, the opening message first. */
  readonly userMessages: readonly LadderMessage[];
  /** The thread title, for the key-suggestion and fuzzy rungs. Titles never
   *  bind: bb generates them from model output. */
  readonly title: string | null;
}

/** Another issue the evidence named, offered rather than bound. */
export interface LadderAlternate {
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
}

export type LadderOutcome =
  | {
      readonly kind: "bound";
      readonly issueId: string;
      readonly teamId: string;
      readonly origin: ThreadLinkOrigin;
      /** False when rung 1 answered — the link already exists and the caller
       *  must not write it again. */
      readonly isNew: boolean;
      /** Which message or branch produced the binding, human-readable — e.g.
       *  `the opening user message ("otto-2222")`. Null when rung 1 answered
       *  and the stored row predates provenance. */
      readonly provenance: string | null;
      /** Other in-scope issues the user's messages named. Never re-binds;
       *  the caller surfaces them as suggestions. */
      readonly alternates: readonly LadderAlternate[];
    }
  | {
      readonly kind: "suggestion";
      readonly issueId: string;
      readonly identifier: string;
      readonly title: string;
      readonly score: number;
    }
  | { readonly kind: "none" };

/** Forty alternates is a pasted report, not a set of suggestions. */
const MAX_ALTERNATES = 3;

/** Every distinct in-scope issue the user's messages name, in first-appearance
 *  order, each with the surface that first named it. */
function issuesNamedByUser(
  deps: LadderDeps,
  messages: readonly LadderMessage[],
): { issue: IssueRow; label: string; identifier: string }[] {
  const found: { issue: IssueRow; label: string; identifier: string }[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    if (message.text === "") continue;
    for (const identifier of identifiersInText(message.text).identifiers) {
      const issue = deps.issueByIdentifier(identifier);
      if (issue === null || !deps.readTeamIds.has(issue.teamId)) continue;
      if (seen.has(issue.id)) continue;
      seen.add(issue.id);
      found.push({ issue, label: message.label, identifier });
    }
  }
  return found;
}

function toAlternates(
  named: readonly { issue: IssueRow }[],
  excludeIssueId: string,
): LadderAlternate[] {
  return named
    .filter((entry) => entry.issue.id !== excludeIssueId)
    .slice(0, MAX_ALTERNATES)
    .map((entry) => ({
      issueId: entry.issue.id,
      identifier: entry.issue.identifier,
      title: entry.issue.title,
    }));
}

export function resolveBinding(deps: LadderDeps, input: LadderInput): LadderOutcome {
  // Rung 1 — an existing link is the answer, whatever made it. A later
  // message naming another issue is surfaced, never silently switched to:
  // re-binding on mention would let one sentence move the write-back target.
  const existing = deps.threadLink(input.threadId);
  if (existing !== null) {
    const named =
      existing.origin === "message" || existing.origin === "branch"
        ? issuesNamedByUser(deps, input.userMessages)
        : [];
    return {
      kind: "bound",
      issueId: existing.issueId,
      teamId: existing.teamId,
      origin: existing.origin,
      isNew: false,
      provenance: existing.provenance ?? null,
      alternates: toAlternates(named, existing.issueId),
    };
  }

  const named = issuesNamedByUser(deps, input.userMessages);

  // Rung 2 — the branch. Scope-checked: a branch that names another team's
  // issue is a fact worth ignoring, not a binding — writing to a board this
  // project cannot read is exactly the accident the scope rules exist for.
  if (input.branchName !== null && input.branchName !== "") {
    const match = deps
      .issuesByBranch(input.branchName)
      .find((issue) => deps.readTeamIds.has(issue.teamId));
    if (match !== undefined) {
      return {
        kind: "bound",
        issueId: match.id,
        teamId: match.teamId,
        origin: "branch",
        isNew: true,
        provenance: `the branch ${input.branchName}`,
        alternates: toAlternates(named, match.id),
      };
    }

    // Rung 2.5 — a human-edited branch can retain the issue key while no
    // longer matching Linear's stored Issue.branchName byte-for-byte. The
    // identifier lookup is also where the caller applies thread-decline
    // memory, so undo suppresses this rung exactly as it suppresses rung 2.
    const identifier = identifierFromBranch(input.branchName);
    if (identifier !== null) {
      const issue = deps.issueByIdentifier(identifier);
      if (issue !== null && deps.readTeamIds.has(issue.teamId)) {
        return {
          kind: "bound",
          issueId: issue.id,
          teamId: issue.teamId,
          origin: "branch",
          isNew: true,
          provenance: `the branch ${input.branchName} (${identifier})`,
          alternates: toAlternates(named, issue.id),
        };
      }
    }
  }

  // Rung 3 — a key in a user message. The first key in the opening message
  // wins: it is overwhelmingly the one the thread is about. Everything else
  // the user named rides along as alternates the chip can offer.
  const first = named[0];
  if (first !== undefined) {
    return {
      kind: "bound",
      issueId: first.issue.id,
      teamId: first.issue.teamId,
      origin: "message",
      isNew: true,
      provenance: `${first.label} ("${first.identifier}")`,
      alternates: toAlternates(named, first.issue.id),
    };
  }

  // Rung 3.5 — a key in the title. Suggestion only: bb titles are generated
  // from model output and agents rename threads, so a title's authorship is
  // unknowable — exactly the text that must never bind on its own.
  if (input.title !== null && input.title !== "") {
    for (const identifier of identifiersInText(input.title).identifiers) {
      const issue = deps.issueByIdentifier(identifier);
      if (issue !== null && deps.readTeamIds.has(issue.teamId)) {
        return {
          kind: "suggestion",
          issueId: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          score: 1,
        };
      }
    }
  }

  // Rung 4 — fuzzy, suggestion only.
  const suggestion = suggestByTitle(input.title, deps.openIssues());
  if (suggestion !== null) return suggestion;

  return { kind: "none" };
}

/* ── The fuzzy rung ──────────────────────────────────────────────────────── */

/** Below this, a match is noise. Chosen against the test fixtures: real pairs
 *  ("Fix the webhook health check" → "Webhook health check demotes to
 *  polling") score well above it, and unrelated titles well below. */
export const SUGGESTION_THRESHOLD = 0.5;
/** The best match must beat the runner-up by this much, or the honest answer
 *  is "ambiguous" and the chip stays quiet. A suggestion that flickers
 *  between two issues is worse than none. */
export const SUGGESTION_MARGIN = 0.15;

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "to", "in", "on", "for", "with", "is", "are",
  "it", "its", "this", "that", "fix", "fixes", "add", "adds", "update",
  "updates", "implement", "implements", "build", "builds", "make", "makes",
]);

function tokens(text: string): Set<string> {
  const found = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    found.add(raw);
  }
  return found;
}

/** Set-cosine over content tokens. Cheap, order-free, and — unlike substring
 *  matching — indifferent to which surface abbreviated what. */
export function titleSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.sqrt(left.size * right.size);
}

function suggestByTitle(
  title: string | null,
  candidates: readonly LadderIssue[],
): LadderOutcome | null {
  if (title === null) return null;
  if (tokens(title).size < 2) return null; // one content word matches everything a little

  let best: { issue: LadderIssue; score: number } | null = null;
  let second = 0;
  for (const issue of candidates) {
    const score = titleSimilarity(title, issue.title);
    if (best === null || score > best.score) {
      second = best?.score ?? 0;
      best = { issue, score };
    } else if (score > second) {
      second = score;
    }
  }

  if (best === null) return null;
  if (best.score < SUGGESTION_THRESHOLD) return null;
  if (best.score - second < SUGGESTION_MARGIN) return null;

  return {
    kind: "suggestion",
    issueId: best.issue.id,
    identifier: best.issue.identifier,
    title: best.issue.title,
    score: best.score,
  };
}
