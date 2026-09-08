import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../src/store/migrations.js";
import { createStore } from "../src/store/store.js";
import { createTestStore, NOW } from "./helpers/store.js";

const link = (issueId: string) => ({ threadId: "t", issueId, teamId: "team", projectId: "p", createdAt: NOW, origin: "manual" as const });

describe("thread work", () => {
  it("migrates a legacy binding with its provenance and original date", () => {
    const db = new Database(":memory:");
    const start = MIGRATIONS.findIndex((s) => s.includes("CREATE TABLE IF NOT EXISTS thread_work ("));
    for (const sql of MIGRATIONS.slice(0, start)) db.prepare(sql).run();
    db.prepare("INSERT INTO thread_link VALUES (?, ?, ?, ?, ?, ?, ?)").run("t", "a", "team", "p", NOW, "message", "opening prompt");
    for (const sql of MIGRATIONS.slice(start)) db.prepare(sql).run();
    const store = createStore(db);
    expect(store.threadWork("t")).toEqual([expect.objectContaining({ issueId: "a", status: "active", createdAt: NOW, provenance: "opening prompt" })]);
    expect(store.threadLink("t")?.issueId).toBe("a");
    db.close();
  });

  it("keeps parallel work when focusing and retains history when switching", () => {
    const store = createTestStore();
    store.linkThread(link("a"));
    store.changeThreadWork({ threadId: "t", action: "add", issue: link("b"), now: NOW + 1 });
    expect(store.threadLink("t")?.issueId).toBe("a");
    store.changeThreadWork({ threadId: "t", action: "focus", issue: link("b"), now: NOW + 2 });
    expect(store.threadLink("t")?.issueId).toBe("b");
    expect(store.threadLinksForIssues(["a", "b"])).toHaveLength(2);
    store.changeThreadWork({ threadId: "t", action: "finish", issue: link("b"), now: NOW + 3 });
    expect(store.threadLink("t")?.issueId).toBe("a");
    store.linkThread(link("c"));
    expect(store.threadWork("t").filter((r) => r.status === "previous").map((r) => r.issueId).sort()).toEqual(["a", "b"]);
    expect(store.threadLink("t")?.issueId).toBe("c");
  });

  it("keeps removal and cleared work across restarts, and allows explicit resumption", () => {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.prepare(sql).run();
    const store = createStore(db);
    store.linkThread(link("a"));
    store.changeThreadWork({ threadId: "t", action: "remove", issue: link("a"), now: NOW + 1 });
    const reloaded = createStore(db);
    expect(reloaded.threadLink("t")).toBeNull();
    expect(reloaded.threadWork("t")[0]?.status).toBe("removed");
    expect(reloaded.threadWorkState("t").managed).toBe(true);
    reloaded.linkThread(link("a"));
    reloaded.unlinkThread("t");
    expect(reloaded.threadWork("t")[0]?.status).toBe("previous");
    expect(reloaded.threadLink("t")).toBeNull();
    db.close();
  });

  it("refuses stale operations and detection without partially changing work", () => {
    const store = createTestStore();
    const revision = store.threadWorkState("t").revision;
    store.linkThread(link("a"));
    expect(store.changeThreadWork({ threadId: "t", action: "start", issue: link("b"), now: NOW, expectedRevision: revision }).ok).toBe(false);
    expect(store.saveThreadEvidence("t", 123, ["b"], revision)).toBe(false);
    expect(store.threadLink("t")?.issueId).toBe("a");
    expect(store.threadWork("t")).toHaveLength(1);
  });

  it("persists evidence and never moves the sequence cursor backwards", () => {
    const store = createTestStore();
    expect(store.saveThreadEvidence("t", 50, ["a", "b"], 0)).toBe(true);
    expect(store.saveThreadEvidence("t", 20, ["c"], 0)).toBe(true);
    expect(store.threadWorkState("t")).toMatchObject({ afterSequence: 50, candidates: ["c"] });
  });

  it("caps concurrent work but permits switching and resuming after completion", () => {
    const store = createTestStore();
    for (let i = 0; i < 20; i++) {
      expect(store.changeThreadWork({ threadId: "t", action: "add", issue: link(String(i)), now: NOW + i }).ok).toBe(true);
    }
    expect(store.changeThreadWork({ threadId: "t", action: "add", issue: link("next"), now: NOW + 21 }).ok).toBe(false);
    expect(store.changeThreadWork({ threadId: "t", action: "start", issue: link("next"), now: NOW + 22 }).ok).toBe(true);
    expect(store.threadWork("t").filter((row) => row.status === "active")).toHaveLength(1);
    expect(store.changeThreadWork({ threadId: "t", action: "add", issue: link("1"), now: NOW + 23 }).ok).toBe(true);
    expect(store.threadWork("t").filter((row) => row.status === "active")).toHaveLength(2);
  });
});
