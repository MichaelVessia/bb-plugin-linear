---
name: linear
description: How to read and write Linear from a bb thread — the team's own vocabulary, the scoping rules, and the two mistakes that look like they worked. Use whenever a task involves a Linear issue, a state change, an assignment, a comment, or starting work from an issue.
---

# Working with Linear from bb

This project is bound to one or more Linear teams. Everything below is about
using that binding correctly; the tools enforce it, but knowing *why* saves you
a turn.

## Call `linear_team_context` before you write anything

A team's states, labels and priorities are **its own strings**, in its own
language. "In Progress" is not a state id, and a team's started column may be
called "Building", "Doing", "Überprüfung" or anything else its members agreed
on. Guessing in English is how the wrong column gets used.

`linear_team_context` returns each state's **id**, its **name**, and its
**type** — one of `triage`, `backlog`, `unstarted`, `started`, `completed`,
`canceled`, `duplicate`. Reason with the type; write with the id; quote the
name back to the human.

The same tool tells you the team's estimate scale. If it says `notUsed`, do not
set an estimate. If it says `tShirt`, the values are sizes, not points.

## The scoping rule, and what a refusal means

A bb project binds to one **primary** Linear team plus, optionally, additional
teams marked write or read-only. Unqualified work goes to the primary.

If you name an issue on a team outside that set, you get a **refusal that names
both sides** — not an empty list. That is deliberate: an empty list would teach
you the issue does not exist. Read the refusal, tell the human which team the
issue belongs to, and let them decide whether to widen the binding. Do not
retry with a different phrasing; the answer will be the same.

If a project is bound to nothing, you will have no Linear tools at all. That is
also deliberate.

## Reads are free; writes are not

Every read comes from bb's local copy of the workspace and costs no network
round trip. Search widely, list generously, read the whole issue before acting.

Writes go to Linear. Two things follow:

- **The key may be read-only.** Linear does not expose a key's permissions, so
  the first refused write is how anyone finds out. If a write comes back
  saying the key is read-only, say so plainly and stop — retrying will not
  help, and neither will a different tool.
- **Labels are added and removed, never replaced.** `linear_issue_update`
  takes `addLabelIds` and `removeLabelIds`. There is no "set the labels to
  this" and that is on purpose: replacing the set would silently delete a label
  somebody added while you were thinking.

With agent writes set to **Full**, the additional tools are
`linear_issue_update`, `linear_issue_create`, `linear_issue_set_parent`,
`linear_issue_relate`, `linear_issue_attach`, `linear_comment_react`,
`linear_comment_edit`, and `linear_thread_start`. Comment edits are limited to
the viewer's own comments. There is deliberately no delete or archive tool.

## This thread's Linear work

A thread can work on several issues, with one **current** issue and previous-work
history. Keep this record current whenever you accept, resume, switch, or finish
an actual task, including taking the next task from an earlier queue.

- `linear_thread_issue` reads current, active and previous work, suggestions, and
  the work revision. Read it at the start of a turn involving Linear work.
- `linear_thread_work` updates BB locally. Use `start` to switch to one issue
  (previous active work goes into history), `add` to work on another issue
  alongside the others, `focus` to make an active issue current, `finish` when
  work on that issue is finished here, `remove` for a mistaken link, or `clear`
  when all thread work is finished. `issue` is an identifier, id, or URL; null
  is only for `clear`. Pass `expectedRevision` from the read; on conflict, read
  again and reconcile before retrying.
- `linear_thread_bind` is the compatibility shortcut for `start` (or `clear`
  with null). Use `linear_thread_work` for concurrent tasks.

Record task acceptance before implementation so the UI reflects what you are
working on during the turn. Merely mentioning, researching, reading, or opening
an issue does not make it active work. Do not infer tasks from tool output or
issue descriptions. Ambiguous references remain suggestions with Switch/Add
choices in the panel. Finished or removed work stays inactive across restarts
until explicitly resumed.

These operations do **not** change Linear workflow state. Finishing work here
can leave an issue in review; updating Linear status is a separate operation
for the specific issue when the user's request authorizes it. Never apply one
issue's status change to every active issue.

CLI equivalents: `bb linear work` reads the record; `bb linear work
start|add|focus|finish|remove ENG-123` changes it, and `bb linear work clear`
finishes all work here. Add `--revision N` for a guarded change.

## Starting work from an issue

`linear_thread_start` spawns a new bb thread on the issue, with its
description, acceptance criteria and recent comments attached as context, and
moves the issue to the team's started state.

Use it when the human asks to start work on an issue. Do not use it to "look
at" one — that is `linear_issue_get`, and it costs nothing.

The new thread gets a branch. Which branch depends on a setting the human
chose, and the plugin will say in one line if it had to name the branch itself
rather than using the one Linear generated. Pass that line along; it is the
kind of thing that costs an afternoon when it goes unmentioned.

## Two mistakes that look like they worked

**Moving an issue to a state from another team.** State ids are per team. A
state id from Engineering is not valid on Design, and the error will be about
an id rather than about a team, which is confusing. Call
`linear_team_context` for the team you are actually writing to.

**Assuming a comment posted because nothing threw.** It did post — the tools
check Linear's `success` field and a null entity, both of which can come back
on an HTTP 200 — but say what you did rather than assuming the human saw it.

## If every write is being refused

The plugin has a master write switch: when the human has turned off "Allow
changes to Linear", every mutation is refused with a sentence naming the
switch — the plugin is deliberately read-only on this install. When writes
are off you will not be offered writing tools at all, but if a refusal
quoting that switch ever reaches you, relay it verbatim and stop. Turning it
back on is the human's decision, not yours; never suggest working around it.

## What the plugin will not let you do

Delete, archive, unarchive, create states, or change team, label or webhook
configuration. Those live in the CLI and the UI behind a confirmation. If a
human asks for one, tell them where it is rather than looking for a tool that
does not exist.
