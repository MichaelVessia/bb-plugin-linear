import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StateGlyph } from "./StateGlyph.js";
import { toneClass } from "../src/select/tone.js";
import type { PaneRelationType } from "../src/pane-write.js";
import { useAsync, useLinearRpc } from "./rpc.js";

interface PickerIssue {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly tone: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" | "duplicate" | "unknown";
}

function IssuePicker({
  teamId,
  excludeIssueId,
  onSelect,
}: {
  teamId: string;
  excludeIssueId: string;
  onSelect: (issue: PickerIssue) => void;
}) {
  const rpc = useLinearRpc();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useAsync(
    useCallback(
      async () => rpc.call("searchIssuesForPicker", { teamId, query: debouncedQuery }),
      [rpc, teamId, debouncedQuery],
    ),
    [teamId, debouncedQuery],
  );
  const searchCurrent = query === debouncedQuery;
  const searching =
    !searchCurrent ||
    results.status === "loading" ||
    (results.status === "ready" && results.refreshing);
  const issues = results.status === "ready" && !results.refreshing && searchCurrent
    ? results.value.issues.filter((issue) => issue.id !== excludeIssueId)
    : [];

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search issues…"
        aria-label="Search issues"
      />
      <div className="bbl-scroller max-h-64 overflow-y-auto">
        {searching ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Searching the local copy…</p>
        ) : issues.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No matching issues.</p>
        ) : (
          <ul className="space-y-1">
            {issues.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  className={`${toneClass(issue.tone)} flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-state-hover`}
                  onClick={() => onSelect(issue)}
                >
                  <StateGlyph tone={issue.tone} />
                  <span className="w-[4.75rem] shrink-0 truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                    {issue.identifier}
                  </span>
                  <span className="truncate text-[13px] text-foreground">{issue.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function AddLinkDialog({
  issueId,
  open,
  onOpenChange,
  onAdded,
}: {
  issueId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const rpc = useLinearRpc();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(() => {
    if (url.trim() === "" || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const result = await rpc.call("attachLink", {
          issueId,
          url: url.trim(),
          ...(title.trim() === "" ? {} : { title: title.trim() }),
        });
        if (!result.ok) {
          toast.error(result.message ?? "That link wasn't added.");
          return;
        }
        toast.success(result.message ?? "Link added.");
        setUrl("");
        setTitle("");
        onOpenChange(false);
        onAdded();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "That link wasn't added.");
      } finally {
        setBusy(false);
      }
    })();
  }, [rpc, issueId, url, title, busy, onOpenChange, onAdded]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-3">
            <Input
              autoFocus
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
              aria-label="Link URL"
            />
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title — optional"
              aria-label="Link title"
            />
          </div>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={busy || url.trim() === ""}>
              {busy ? "Adding…" : "Add link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ParentPickerDialog({
  issueId,
  teamId,
  open,
  onOpenChange,
  onSet,
}: {
  issueId: string;
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSet: (parentId: string) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set parent</DialogTitle>
        </DialogHeader>
        <IssuePicker
          teamId={teamId}
          excludeIssueId={issueId}
          onSelect={(issue) => {
            void onSet(issue.id).then((ok) => {
              if (ok) onOpenChange(false);
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

const RELATION_LABELS: ReadonlyArray<{ value: PaneRelationType; label: string }> = [
  { value: "blockedBy", label: "Blocked by" },
  { value: "blocks", label: "Blocks" },
  { value: "related", label: "Related" },
  { value: "duplicateOf", label: "Duplicate of" },
];

export function RelationPickerDialog({
  issueId,
  teamId,
  open,
  onOpenChange,
  onRelate,
}: {
  issueId: string;
  teamId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRelate: (relatedIssueId: string, type: PaneRelationType) => Promise<boolean>;
}) {
  const [type, setType] = useState<PaneRelationType>("blockedBy");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add relation</DialogTitle>
        </DialogHeader>
        <Select value={type} onValueChange={(value) => setType(value as PaneRelationType)}>
          <SelectTrigger className="h-8 text-sm" aria-label="Relation type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RELATION_LABELS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IssuePicker
          teamId={teamId}
          excludeIssueId={issueId}
          onSelect={(issue) => {
            void onRelate(issue.id, type).then((ok) => {
              if (ok) onOpenChange(false);
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
