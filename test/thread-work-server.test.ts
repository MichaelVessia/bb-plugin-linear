import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import { createStore } from "../src/store/store.js";
import { issue, NOW, state, team } from "./helpers/store.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  let rows: unknown[] = [];
  const thread = makeThreadResponse({ id: "t", projectId: "p", environmentId: null });
  const { bb, harness } = createFakePluginHost({ pluginId: "linear", sdk: {
    threads: { get: async () => thread, timeline: async () => ({ rows }) as never },
    projects: { list: async () => ({ projects: [] }) as never },
  } });
  cleanups.push(() => harness.lifecycle.dispose());
  await plugin(bb as never);
  const store = createStore(bb.storage.database() as never);
  store.putTeams([team("team_eng", "ENG")], NOW);
  store.replaceWorkflowStates("team_eng", [state("todo", "team_eng", "unstarted"), state("done", "team_eng", "completed")]);
  store.putIssues([issue({ id: "a", identifier: "ENG-1", stateId: "todo" }), issue({ id: "b", identifier: "ENG-2", stateId: "todo" })], NOW);
  // CLI bind refreshes the server's scope snapshot through its real path.
  const bound = await harness.behavior.runCli(["bind", "ENG", "--project", "p"]);
  expect(bound.exitCode).toBe(0);
  const rpc = (name: string, input: unknown) => harness.behavior.callRpc(name, input) as Promise<any>;
  return { store, harness, rpc, setRows: (value: unknown[]) => { rows = value; } };
}

describe("thread work server", () => {
  it("keeps singular/batch views in sync through add, focus, finish and stale UI writes", async () => {
    const { store, rpc } = await fixture();
    expect(await rpc("updateThreadWork", { threadId: "t", action: "start", issue: "ENG-1", expectedRevision: 0 })).toMatchObject({ ok: true });
    expect(await rpc("updateThreadWork", { threadId: "t", action: "add", issue: "ENG-2", expectedRevision: 1 })).toMatchObject({ ok: true });
    let single = await rpc("threadIssue", { threadId: "t" });
    expect(single).toMatchObject({ binding: { issueId: "a" }, activeCount: 2, revision: 2 });
    expect(await rpc("updateThreadWork", { threadId: "t", action: "focus", issue: "ENG-2", expectedRevision: 1 })).toMatchObject({ ok: false });
    await rpc("updateThreadWork", { threadId: "t", action: "focus", issue: "ENG-2", expectedRevision: 2 });
    single = await rpc("threadIssue", { threadId: "t" });
    const batch = await rpc("threadIssues", { threadIds: ["t"] });
    expect(batch.threads.t.binding.issueId).toBe(single.binding.issueId);
    expect(batch.threads.t.active).toEqual(single.active);
    await rpc("updateThreadWork", { threadId: "t", action: "finish", issue: "ENG-2", expectedRevision: 3 });
    expect(await rpc("threadIssue", { threadId: "t" })).toMatchObject({ binding: { issueId: "a" }, history: [{ issueId: "b" }], activeCount: 1 });
    expect(store.issue("a")?.stateId).toBe("todo");
    expect(store.issue("b")?.stateId).toBe("todo");
  });

  it("offers later references on a manual binding without switching it", async () => {
    const { rpc, store, setRows } = await fixture();
    await rpc("bindThread", { threadId: "t", issueId: "a" });
    setRows(Array.from({ length: 35 }, (_, index) => ({ kind: "conversation", role: "user",
      initiator: "user", systemMessageKind: "unlabeled", sourceSeqStart: index + 1, sourceSeqEnd: index + 1,
      turnRequest: { status: "accepted" }, text: index === 34 ? "Next work is ENG-2" : "Continue" })));
    await rpc("threadIssue", { threadId: "t" });
    await expect.poll(() => store.threadWorkState("t").afterSequence).toBe(35);
    expect(await rpc("threadIssue", { threadId: "t" })).toMatchObject({ binding: { issueId: "a" }, alternates: [{ issueId: "b" }] });
    await rpc("updateThreadWork", { threadId: "t", action: "start", issue: "b" });
    expect(await rpc("threadIssue", { threadId: "t" })).toMatchObject({ binding: { issueId: "b" }, history: [{ issueId: "a" }], alternates: [] });
  });

  it("refuses out-of-scope and ambiguous identifiers without modifying active work", async () => {
    const { rpc, store, harness } = await fixture();
    store.putTeams([team("other", "OTHER")], NOW);
    store.putIssues([issue({ id: "outside", identifier: "OTHER-1", teamId: "other" })], NOW);
    expect(await rpc("updateThreadWork", { threadId: "t", action: "start", issue: "outside" })).toMatchObject({ ok: false });
    expect(store.threadWork("t")).toEqual([]);
    await harness.behavior.runCli(["bind", "OTHER", "--project", "p", "--role", "read"]);
    store.putIssues([issue({ id: "duplicate", identifier: "ENG-1", teamId: "other" })], NOW);
    expect(await rpc("updateThreadWork", { threadId: "t", action: "start", issue: "ENG-1" })).toMatchObject({ ok: false });
    expect(await rpc("updateThreadWork", { threadId: "t", action: "start", issue: "a" })).toMatchObject({ ok: true });
  });

  it("provides the same transitions through the CLI and agent tool", async () => {
    const { rpc, harness } = await fixture();
    expect((await harness.behavior.runCli(["work", "start", "ENG-1", "--thread", "t", "--revision", "0"])).exitCode).toBe(0);
    const result = await harness.behavior.callAgentTool("linear_thread_work", {
      action: "add", issue: "ENG-2", expectedRevision: 1,
    }, { threadId: "t", projectId: "p" } as never);
    expect(JSON.stringify(result)).toContain("added to active work");
    const view = await rpc("threadIssue", { threadId: "t" });
    expect(view.activeCount).toBe(2);
    const read = await harness.behavior.runCli(["work", "--thread", "t"]);
    expect(JSON.parse(read.stdout).activeCount).toBe(2);
    expect((await harness.behavior.runCli(["work", "start", "ENG-1", "--thread", "t", "--revision", "0"])).exitCode).toBe(1);
    await harness.behavior.runCli(["work", "clear", "--thread", "t"]);
    expect(await rpc("threadIssue", { threadId: "t" })).toMatchObject({ binding: null, activeCount: 0, historyCount: 2 });
  });
});
