import { describe, expect, it } from "vitest";
import { collectThreadEvidence, type EvidenceRow } from "../src/thread-evidence.js";

const user = (n: number, text = `work on ENG-${n}`): EvidenceRow => ({
  kind: "conversation", role: "user", initiator: "user", systemMessageKind: "unlabeled",
  sourceSeqStart: n, sourceSeqEnd: n, text, turnRequest: { status: "accepted" },
});

describe("incremental thread evidence", () => {
  it("sees task changes beyond the first twenty messages and prioritizes the newest", () => {
    const result = collectThreadEvidence(Array.from({ length: 35 }, (_, n) => user(n + 1)), 0);
    expect(result.messages).toHaveLength(20);
    expect(result.messages[0]?.text).toBe("work on ENG-35");
    expect(result.afterSequence).toBe(35);
    expect(collectThreadEvidence([user(35), user(36)], 35).messages.map((m) => m.text)).toEqual(["work on ENG-36"]);
  });
  it("excludes research, system steers, and rejected requests", () => {
    const result = collectThreadEvidence([
      { ...user(1), role: "assistant" }, { ...user(2), initiator: "agent" },
      { ...user(3), systemMessageKind: "child-completed" },
      { ...user(4), turnRequest: { status: "rejected" } }, user(5),
    ], 0);
    expect(result.messages.map((m) => m.text)).toEqual(["work on ENG-5"]);
    expect(result.afterSequence).toBe(5);
  });
  it("does not consume pending work and processes it when accepted", () => {
    const queued = { ...user(2), turnRequest: { status: "pending" } };
    expect(collectThreadEvidence([user(1), queued, user(3)], 0).afterSequence).toBe(1);
    expect(collectThreadEvidence([user(2), user(3)], 1).messages).toHaveLength(2);
  });
});
