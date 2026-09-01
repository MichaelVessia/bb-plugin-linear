export interface Wake {
  /** Set the level-triggered latch. Multiple wakes collapse into one. */
  wake(): void;
  /** Resolve on the timeout, a permitted latch wake, or abort. */
  wait(ms: number, signal?: AbortSignal): Promise<void>;
}

/**
 * A level-triggered wake latch for a single service loop.
 *
 * Wakes are remembered across gaps between waits. A latch may resolve a wait
 * no sooner than `minSpacingMs` after the previous wait resolved, while the
 * ordinary timeout and abort remain unaffected by that spacing.
 */
export function createWake(minSpacingMs: number): Wake {
  let latched = false;
  let lastResolvedAt: number | null = null;
  let notifyWaiting: (() => void) | null = null;

  return {
    wake() {
      latched = true;
      notifyWaiting?.();
    },

    wait(ms, signal) {
      if (signal?.aborted) {
        latched = false;
        lastResolvedAt = Date.now();
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let latchTimer: ReturnType<typeof setTimeout> | null = null;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (timeout !== null) clearTimeout(timeout);
          if (latchTimer !== null) clearTimeout(latchTimer);
          signal?.removeEventListener("abort", finish);
          if (notifyWaiting === scheduleLatch) notifyWaiting = null;
          latched = false;
          lastResolvedAt = Date.now();
          resolve();
        };

        const scheduleLatch = () => {
          if (!latched || settled || latchTimer !== null) return;
          const allowedAt = (lastResolvedAt ?? -Infinity) + minSpacingMs;
          const delay = Math.max(0, allowedAt - Date.now());
          latchTimer = setTimeout(finish, delay);
        };

        notifyWaiting = scheduleLatch;
        timeout = setTimeout(finish, Math.max(0, ms));
        signal?.addEventListener("abort", finish, { once: true });
        scheduleLatch();
      });
    },
  };
}
