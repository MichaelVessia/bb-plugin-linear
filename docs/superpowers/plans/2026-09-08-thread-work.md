# Thread work implementation plan

**Goal:** Track sequential and concurrent Linear work in one BB thread.

**Architecture:** A durable membership table holds active, previous and removed issues. The existing `thread_link` table remains the current-issue compatibility projection. Atomic operations update both. A persisted message cursor and revision prevent old prompts and competing evaluations from restoring stale work.

**Tech stack:** TypeScript, SQLite, Zod, React, Vitest, BB Plugin SDK.

**Spec:** The user-approved six-step design in this thread: multiple active issues, one current issue, previous-work history, explicit agent transitions, incremental detection, shared UI state, compatibility and issue-specific automation.

## Constraints

- An issue reference alone is not a task transition; assistant/tool/system text never auto-binds.
- Work membership is local to BB and does not change Linear workflow state.
- Keep existing singular APIs as a projection; preserve migration prefixes and provenance.
- Resolve all explicit operations within the thread's readable team scope.
- Preserve removals across restarts and keep reads bounded.

## Implementation

- [x] Store: append membership/state migrations; implement atomic start/add/focus/finish/remove/clear with revision checks and legacy link projection. Test migration, history, removal, resumption and conflicts.
- [x] Detection: process accepted user messages after the stored sequence, persist bounded suggestions, suppress old branch/prompt evidence after explicit work changes, serialize evaluations. Test long threads, pending/rejected messages and old evidence.
- [x] Contracts: expose work operations through RPC, agent tools and CLI; extend singular/batch responses with active work, history and revision. Test compatibility and validation.
- [x] Context: describe current/active/previous work and require the agent to record task acceptance, focus and completion. Keep status writes issue-specific.
- [x] UI: current issue plus count; active list, suggestion actions and history; independent detail selection; direct add/switch controls; realtime refresh and stale-operation refusal.
- [x] Verification: focused tests, full `npm run check`, plugin build, rendered React interaction tests and installed-plugin CLI smoke check. Review diff and record any unavailable live-host proof.


## Verification evidence

- `npm run check`: TypeScript and 984 tests across 54 files passed.
- `bb plugin build`: server and app artifacts built successfully.
- Existing vendored SDK declarations restored after the build's automatic refresh; `npm run typecheck` also passed against that original SDK surface.
- `bb plugin reload linear --json`: succeeded for the installed local-path plugin.
- Live `bb linear work`: returned the new current/active/history/revision contract.
- React tests exercise focus, completion, header counts, independent detail selection, realtime refresh and stale-write refusal; server tests exercise the actual RPC, CLI and agent-tool handlers.
- Live browser screenshots and visual layout inspection were unavailable: the computer-use connector returned no available browser. Rendered tests do not establish visual layout quality.
- Updated the companion `/Users/vedranburojevic/Git/bb-plugin-activity-sidebar` consumer: it retains `activeCount` through both RPC boundaries and shows the additional count in compact/expanded rows and hover details. TypeScript, 12 focused consumer/UI tests, and its plugin build passed. It retains its existing 30-second cache refresh cycle.
