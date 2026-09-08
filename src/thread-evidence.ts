import type { LadderMessage } from "./binding.js";

export interface EvidenceRow {
  readonly kind: string;
  readonly role?: string;
  readonly initiator?: string;
  readonly systemMessageKind?: string;
  readonly turnRequest?: { readonly status: string } | null;
  readonly sourceSeqStart?: number;
  readonly sourceSeqEnd?: number;
  readonly text?: string;
}

/** Consume accepted human requests in sequence order. A queued request must
 * not become work, or be skipped forever when a later event advances. */
export function collectThreadEvidence(rows: readonly EvidenceRow[], afterSequence: number): {
  messages: LadderMessage[]; afterSequence: number;
} {
  const ordered = rows.filter((row) => (row.sourceSeqEnd ?? 0) > afterSequence)
    .sort((a, b) => (a.sourceSeqStart ?? 0) - (b.sourceSeqStart ?? 0));
  let cursor = afterSequence;
  const messages: LadderMessage[] = [];
  for (const row of ordered) {
    const human = row.kind === "conversation" && row.role === "user" &&
      row.initiator === "user" && row.systemMessageKind === "unlabeled";
    if (human && row.turnRequest?.status === "pending") break;
    cursor = Math.max(cursor, row.sourceSeqEnd ?? cursor);
    if (!human || row.turnRequest?.status !== "accepted") continue;
    const text = row.text?.trim() ?? "";
    if (!text) continue;
    messages.push({ text, label: `user message at sequence ${row.sourceSeqStart}` });
  }
  // The latest intent matters on an existing long thread. Bounded text work;
  // the cursor still accounts for all consumed rows.
  return { messages: messages.slice(-20).reverse(), afterSequence: cursor };
}
