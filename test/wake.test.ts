import { describe, expect, it } from "vitest";
import { createWake } from "../src/sync/wake.js";

describe("createWake", () => {
  it("remembers a wake before wait and resolves promptly", async () => {
    const wake = createWake(20);
    wake.wake();
    const started = Date.now();
    await wake.wait(1_000);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("resolves early when woken during a wait", async () => {
    const wake = createWake(20);
    const started = Date.now();
    const waiting = wake.wait(1_000);
    setTimeout(() => wake.wake(), 10);
    await waiting;
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("enforces spacing between latch-triggered resolves", async () => {
    const wake = createWake(40);
    wake.wake();
    await wake.wait(1_000);
    wake.wake();
    const started = Date.now();
    await wake.wait(1_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });

  it("lets the ordinary timeout resolve before latch spacing", async () => {
    const wake = createWake(100);
    wake.wake();
    await wake.wait(1_000);
    wake.wake();
    const started = Date.now();
    await wake.wait(10);
    expect(Date.now() - started).toBeLessThan(70);
  });

  it("resolves promptly on abort like the existing sleep contract", async () => {
    const wake = createWake(20);
    const controller = new AbortController();
    const started = Date.now();
    const waiting = wake.wait(1_000, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await waiting;
    expect(Date.now() - started).toBeLessThan(100);
  });
});
