import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ThreadIssue } from "../src/rpc.js";
import type { WorkAction } from "../src/store/thread-work.js";
import { useLinearRpc } from "./rpc.js";
import { StateGlyph } from "./StateGlyph.js";

export function ThreadWorkControls({ threadId, work, reload, onSelect }: {
  threadId: string; work: ThreadIssue; reload: () => void; onSelect: (issueId: string) => void;
}) {
  const rpc = useLinearRpc();
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function change(action: WorkAction, issue: string | null) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await rpc.call("updateThreadWork", { threadId, action, issue, expectedRevision: work.revision });
      setMessage(result.message);
      if (result.ok) setInput("");
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update thread work.");
    } finally {
      setPending(false);
    }
  }
  const candidates = [...(work.suggestion ? [work.suggestion] : []), ...work.alternates]
    .filter((row, index, all) => all.findIndex((other) => other.issueId === row.issueId) === index &&
      !work.active.some((active) => active.issueId === row.issueId));
  const actionButton = (label: string, action: WorkAction, issueId: string) => (
    <Button key={action} size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={pending}
      onClick={() => void change(action, issueId)}>{label}</Button>
  );
  return (
    <section aria-label="Thread Linear work" className="space-y-3 border-b border-border pb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Active work{work.activeCount > 0 ? ` (${work.activeCount})` : ""}</h2>
        {work.activeCount > 0 && <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending}
          onClick={() => void change("clear", null)}>Finish all here</Button>}
      </div>
      {work.active.length === 0 && <p className="text-sm text-muted-foreground">No current issue. Add an issue when this thread starts work on it.</p>}
      <ul className="space-y-2">
        {work.active.map((issue) => (
          <li key={issue.issueId} className="rounded-md border border-border p-2">
            <button className="flex w-full items-start gap-2 text-left text-sm hover:underline"
              onClick={() => onSelect(issue.issueId)}>
              <StateGlyph tone={issue.tone} glyph={issue.glyph} />
              <span className="min-w-0 break-words"><span className="font-medium">{issue.identifier}</span> · {issue.title}</span>
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-xs text-muted-foreground">{issue.stateName}{work.binding?.issueId === issue.issueId ? " · Current" : ""}</span>
              {work.binding?.issueId !== issue.issueId && actionButton("Make current", "focus", issue.issueId)}
              {actionButton("Finish here", "finish", issue.issueId)}
              {actionButton("Remove", "remove", issue.issueId)}
            </div>
          </li>
        ))}
      </ul>
      {candidates.length > 0 && <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Suggested by this conversation</h3>
        {candidates.map((issue) => <div key={issue.issueId} className="rounded-md border border-dashed border-border p-2">
          <button className="text-left text-sm hover:underline" onClick={() => onSelect(issue.issueId)}>{issue.identifier} · {issue.title}</button>
          <div className="mt-1 flex flex-wrap gap-1">
            {actionButton("Switch to", "start", issue.issueId)}
            {actionButton("Add to current work", "add", issue.issueId)}
          </div>
        </div>)}
      </div>}
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (input.trim()) void change("add", input.trim()); }}>
        <label htmlFor={`linear-work-${threadId}`} className="text-xs text-muted-foreground">Add an issue by identifier or URL</label>
        <Input id={`linear-work-${threadId}`} value={input} onChange={(event) => setInput(event.target.value)} placeholder="ENG-123" disabled={pending} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" type="submit" disabled={pending || !input.trim()}>Add to work</Button>
          <Button size="sm" variant="ghost" type="button" disabled={pending || !input.trim()}
            onClick={() => void change("start", input.trim())}>Switch to</Button>
        </div>
      </form>
      {work.historyCount > 0 && <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">Previous work ({work.historyCount})</summary>
        <ul className="mt-2 space-y-2">
          {work.history.map((issue) => <li key={issue.issueId} className="rounded-md border border-border p-2">
            <button className="text-left text-sm hover:underline" onClick={() => onSelect(issue.issueId)}>{issue.identifier} · {issue.title}</button>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">{issue.stateName}</span>
              {actionButton("Resume alongside", "add", issue.issueId)}
              {actionButton("Switch to", "start", issue.issueId)}
              {actionButton("Remove", "remove", issue.issueId)}
            </div>
          </li>)}
        </ul>
        {work.historyCount > work.history.length && <p className="mt-2 text-xs text-muted-foreground">Showing the latest {work.history.length} available issues. Older work can be resumed by identifier.</p>}
      </details>}
      <p className="text-xs text-muted-foreground">Finishing work here keeps its history. Linear status is managed separately.</p>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}
