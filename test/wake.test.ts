import { describe, expect, it } from "vitest";
import { createWake } from "../src/sync/wake.js";

/**
 * Real timers, generous margins. Each test proves which PATH resolved the
 * wait — the latch, the timeout, or the abort — by giving the losing path a
 * deadline seconds away and asserting the wait came back well before it. The
 * margins are wide (whole seconds) on purpose: a loaded machine stalls the
 * event loop for tens of milliseconds, and a freshness test that flakes under
 * load blocks releases with noise.
 */
describe("createWake", () => {
  it("remembers a wake before wait and resolves promptly", async () => {
    const wake = createWake(20);
    wake.wake();
    const started = Date.now();
    await wake.wait(10_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("resolves early when woken during a wait", async () => {
    const wake = createWake(20);
    const started = Date.now();
    const waiting = wake.wait(10_000);
    setTimeout(() => wake.wake(), 10);
    await waiting;
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("enforces spacing between latch-triggered resolves", async () => {
    const wake = createWake(40);
    wake.wake();
    await wake.wait(10_000);
    wake.wake();
    const started = Date.now();
    await wake.wait(10_000);
    // A lower bound cannot flake under load — delays only grow.
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });

  it("lets the ordinary timeout resolve before latch spacing", async () => {
    const wake = createWake(10_000);
    wake.wake();
    await wake.wait(0);
    wake.wake();
    const started = Date.now();
    await wake.wait(10);
    // The latch may not fire for another ten seconds; only the timed path
    // can have answered this quickly.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("resolves promptly on abort like the existing sleep contract", async () => {
    const wake = createWake(20);
    const controller = new AbortController();
    const started = Date.now();
    const waiting = wake.wait(10_000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await waiting;
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
