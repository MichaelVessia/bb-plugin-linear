import { formatDateTime, formatTimelessDate, pluralize, truncate } from "./format.js";
import { formatEstimate } from "./select/detail.js";
import type {
  CommentRow,
  AttachmentRow,
  DocumentRow,
  RelationDetailRow,
  IssueRow,
  LabelRow,
  MemberRow,
  TeamRow,
  WorkflowStateRow,
} from "./store/rows.js";

/**
 * What an agent actually reads.
 *
 * **A returned string *is* the text the model sees**, so these are prose, not
 * JSON dumps. A model handed `{"stateId":"a1b2…","assigneeId":"c3d4…"}` learns
 * nothing it can use and spends tokens learning it; a model handed
 * "ENG-42 · In Progress · assigned to Ada Lovelace" can answer a question
 * about it immediately and can quote it back to a human without translating.
 *
 * Ids appear only where an agent needs one to make a *call* — and where they
 * do, they are labelled, because an unlabelled UUID in prose is noise.
 */

export interface IssueContext {
  readonly states: ReadonlyMap<string, WorkflowStateRow>;
  readonly members: ReadonlyMap<string, MemberRow>;
  readonly labels: ReadonlyMap<string, LabelRow>;
  readonly priorityLabels: ReadonlyMap<number, string>;
  readonly teams: ReadonlyMap<string, TeamRow>;
}

/** One line, for a list. Dense enough that twenty of them still read. */
export function issueLine(issue: IssueRow, context: IssueContext): string {
  const state = issue.stateId === null ? undefined : context.states.get(issue.stateId);
  const assignee = issue.assigneeId === null ? undefined : context.members.get(issue.assigneeId);
  const parts = [`${issue.identifier}`, truncate(issue.title, 90)];
  if (state !== undefined) parts.push(state.name);
  if (assignee !== undefined) parts.push(assignee.displayName);
  return parts.join(" · ");
}

/** The whole issue, for `linear_issue_get`. */
export function issueDetailText(
  issue: IssueRow,
  context: IssueContext,
  extras: {
    readonly comments?: readonly CommentRow[];
    readonly subIssues?: readonly { identifier: string; title: string; done: boolean }[];
    readonly parent?: { identifier: string; title: string } | null;
    readonly attachments?: readonly AttachmentRow[];
    readonly documents?: readonly DocumentRow[];
    readonly relations?: readonly RelationDetailRow[];
    readonly activity?: readonly {
      readonly at: number;
      readonly actor: string;
      readonly text: string;
    }[];
  } = {},
): string {
  const state = issue.stateId === null ? undefined : context.states.get(issue.stateId);
  const team = context.teams.get(issue.teamId);
  const assignee = issue.assigneeId === null ? undefined : context.members.get(issue.assigneeId);
  const lines: string[] = [];

  lines.push(`${issue.identifier} — ${issue.title}`);

  const facts: string[] = [];
  if (state !== undefined) facts.push(`State: ${state.name} (${state.type})`);
  if (team !== undefined) facts.push(`Team: ${team.name} (${team.key})`);
  facts.push(`Priority: ${context.priorityLabels.get(issue.priority) ?? "unknown"}`);
  if (assignee !== undefined) facts.push(`Assignee: ${assignee.displayName}`);
  const estimate = formatEstimate(issue.estimate, team?.estimationType ?? "notUsed");
  if (estimate !== null) facts.push(`Estimate: ${estimate}`);
  if (issue.dueDate !== null) facts.push(`Due: ${formatTimelessDate(issue.dueDate)}`);
  const labels = issue.labelIds
    .map((id) => context.labels.get(id)?.name)
    .filter((name): name is string => name !== undefined);
  if (labels.length > 0) facts.push(`Labels: ${labels.join(", ")}`);
  if (issue.branchName !== null) facts.push(`Branch: ${issue.branchName}`);
  if (issue.url !== null) facts.push(`URL: ${issue.url}`);
  facts.push(`Issue id: ${issue.id}`);
  lines.push(facts.join("\n"));

  if (issue.description !== null && issue.description.trim() !== "") {
    lines.push(`Description:\n${issue.description.trim()}`);
  }

  if (extras.parent !== undefined && extras.parent !== null) {
    lines.push(`Parent: ${extras.parent.identifier} — ${extras.parent.title}`);
  }

  const resources = [
    ...(extras.attachments ?? []).map((item) => ({
      title: item.title,
      subtitle: item.subtitle,
      url: item.url,
    })),
    ...(extras.documents ?? []).map((item) => ({
      title: item.title,
      subtitle: null,
      url: item.url,
    })),
  ];
  if (resources.length > 0) {
    lines.push(
      `Resources:\n${resources
        .map((item) =>
          `  ${[item.title, item.subtitle, item.url].filter((part) => part !== null && part !== "").join(" — ")}`,
        )
        .join("\n")}`,
    );
  }

  const relations = extras.relations ?? [];
  if (relations.length > 0) {
    lines.push(
      `Relations:\n${relations
        .map((relation) => {
          const label =
            relation.type === "blocks"
              ? relation.inverse ? "blocked by" : "blocks"
              : relation.type === "duplicate"
                ? relation.inverse ? "duplicates" : "duplicate of"
                : "related";
          return `  ${label}: ${relation.identifier ?? relation.counterpartId} — ${relation.title ?? "Unknown issue"}`;
        })
        .join("\n")}`,
    );
  }

  const subIssues = extras.subIssues ?? [];
  if (subIssues.length > 0) {
    const done = subIssues.filter((child) => child.done).length;
    lines.push(
      `Sub-issues (${done} of ${subIssues.length} done):\n${subIssues
        .map((child) => `  ${child.done ? "[x]" : "[ ]"} ${child.identifier} ${child.title}`)
        .join("\n")}`,
    );
  }

  const comments = extras.comments ?? [];
  if (comments.length > 0) {
    lines.push(
      `Comments (${comments.length}):\n${comments
        .map((comment) => {
          const author =
            comment.userId === null
              ? "Someone"
              : (context.members.get(comment.userId)?.displayName ?? "Someone");
          return `  ${author}: ${truncate(comment.body.replace(/\s+/g, " "), 400)}`;
        })
        .join("\n")}`,
    );
  }

  const activity = (extras.activity ?? []).slice(-30);
  if (activity.length > 0) {
    lines.push(
      `Activity (last ${activity.length}):\n${activity
        .map((entry) => `  ${formatDateTime(entry.at)} — ${entry.actor}: ${entry.text}`)
        .join("\n")}`,
    );
  }

  return lines.join("\n\n");
}

/**
 * The team's own vocabulary — the tool that stops a model inventing
 * "In Progress" at a team that calls its column "Building".
 *
 * Every name here comes from the workspace. Nothing in this function is a
 * constant except the field labels, and `type` is included beside each state
 * name precisely so a model can reason about *meaning* without matching on
 * English.
 */
export function teamContextText(input: {
  readonly team: TeamRow;
  readonly states: readonly WorkflowStateRow[];
  readonly labels: readonly LabelRow[];
  readonly members: readonly MemberRow[];
  readonly priorities: readonly { priority: number; label: string }[];
}): string {
  const { team } = input;
  const lines: string[] = [];

  lines.push(`${team.name} (${team.key}) — team id ${team.id}`);

  lines.push(
    `Workflow states, in the team's own words. Use the id when writing; the type says what the state MEANS, and matching on the name would be matching on English:\n${input.states
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((state) => `  ${state.name} — type ${state.type} — id ${state.id}`)
      .join("\n")}`,
  );

  if (input.labels.length > 0) {
    lines.push(
      `Labels (a label with no team is workspace-level and usable here):\n${input.labels
        .map((label) => `  ${label.name} — id ${label.id}${label.teamId === null ? " (workspace)" : ""}`)
        .join("\n")}`,
    );
  }

  if (input.members.length > 0) {
    lines.push(
      `People who can be assigned:\n${input.members
        .map((member) => `  ${member.displayName} — id ${member.id}${member.isMe ? " (you, the signed-in user)" : ""}`)
        .join("\n")}`,
    );
  }

  lines.push(
    `Priorities, in this workspace's own words:\n${input.priorities
      .map((entry) => `  ${entry.priority} = ${entry.label}`)
      .join("\n")}`,
  );

  lines.push(
    team.estimationType === "notUsed"
      ? "Estimates: this team does not use them. Do not set one."
      : `Estimates: ${team.estimationType} scale. They are not "points" unless the scale says so.`,
  );

  if (team.triageEnabled) {
    lines.push("Triage is enabled on this team, so `triage` is a real state type here.");
  }

  return lines.join("\n\n");
}

/** A short confirmation, in the same register. An agent that just moved an
 *  issue needs to know it worked and what it now says, not a payload. */
export function changeSummary(
  issue: IssueRow,
  context: IssueContext,
  changed: readonly string[],
): string {
  const state = issue.stateId === null ? undefined : context.states.get(issue.stateId);
  const what = changed.length === 0 ? "Updated" : `Changed ${changed.join(", ")} on`;
  return `${what} ${issue.identifier}. It is now ${state?.name ?? "in an unknown state"}.`;
}

export function listSummary(
  issues: readonly IssueRow[],
  context: IssueContext,
  scopeLabel: string,
): string {
  if (issues.length === 0) return `No issues match that in ${scopeLabel}.`;
  return `${issues.length} ${pluralize(issues.length, "issue", "issues")} in ${scopeLabel}:\n${issues
    .map((issue) => `  ${issueLine(issue, context)}`)
    .join("\n")}`;
}
