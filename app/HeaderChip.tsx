import { useCallback, type CSSProperties } from "react";
import { useBbNavigate, useRealtime } from "@bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { useAsync, useLinearRpc } from "./rpc.js";
import { StateGlyph } from "./StateGlyph.js";
import { toneClass } from "../src/select/tone.js";

/**
 * The thread header's one control: which issue this thread is working on.
 *
 * The header row is 48px chrome with 28px controls and the host clamps
 * anything taller, so this is a single button in all three states:
 *
 *  - **Bound** — state-toned dot + identifier. Click opens the issue panel.
 *  - **Suggested** — the fuzzy rung's candidate, drawn as a question
 *    ("LIN-3?") in muted chrome. Click accepts, which *is* a manual binding
 *    and records itself as one.
 *  - **Nothing to say** — renders nothing. An empty affordance in every
 *    thread header would be chrome for chrome's sake.
 */
export function HeaderChip({ threadId }: { threadId: string; projectId: string | null; isCompactViewport: boolean }) {
  const rpc = useLinearRpc();
  const navigate = useBbNavigate();

  const state = useAsync(
    useCallback(async () => rpc.call("threadIssue", { threadId }), [rpc, threadId]),
    [threadId],
  );
  useRealtime("linear:data", state.reload);

  if (state.status !== "ready") return null;
  const { binding, suggestion, activeCount, historyCount, alternates } = state.value;

  if (binding !== null) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className={`${toneClass(binding.tone)} h-7 gap-1.5 px-2 text-xs font-medium`}
        style={binding.glyph.color === null ? undefined : ({ "--bbl": binding.glyph.color } as CSSProperties)}
        aria-label={`${activeCount} active Linear issues. Current issue ${binding.identifier} · ${binding.title} — ${binding.stateName}, bound via ${binding.origin}${binding.provenance === null ? "" : ` — ${binding.provenance}`}`}
        onClick={() => {
          navigate.openThreadPanel({ actionId: "issue", title: binding.identifier });
        }}
      >
        {/* The same shaped glyph the panel's rows draw — one state language
            everywhere, so "half-filled ring" means started in the header
            exactly as it does in the list. */}
        <StateGlyph tone={binding.tone} glyph={binding.glyph} />
        <span className="bbl-text">{binding.identifier}</span>
        {activeCount > 1 && <span className="text-muted-foreground">+{activeCount - 1}</span>}
      </Button>
    );
  }

  if (suggestion !== null || alternates.length > 0 || historyCount > 0) {
    return (
      <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        aria-label={historyCount > 0 ? `Linear: no current issue, ${historyCount} previous issues` : "Review suggested Linear issues"}
        onClick={() => navigate.openThreadPanel({ actionId: "issue", title: "Linear work" })}>
        {historyCount > 0 ? `Linear · ${historyCount} previous` : `${suggestion?.identifier ?? alternates[0]?.identifier}?`}
      </Button>
    );
  }
  return null;
}
