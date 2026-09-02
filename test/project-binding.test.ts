import { describe, expect, it } from "vitest";
import { KV } from "../src/kv.js";
import { bindProject, unbindProject } from "../src/project-binding.js";
import { createTestStore, NOW } from "./helpers/store.js";

function harness() {
  const values = new Map<string, unknown>();
  const store = createTestStore();
  return {
    values,
    deps: {
      store,
      kv: {
        write: async (key: string, value: unknown) => {
          values.set(key, value);
        },
        remove: async (key: string) => {
          values.delete(key);
        },
      },
      now: () => NOW,
    },
  };
}

describe("project binding mutations", () => {
  it("records a durable decline when an automatic primary binding is unbound", async () => {
    const h = harness();
    await bindProject(h.deps, {
      projectId: "proj_1",
      teamId: "team_eng",
      role: "primary",
      origin: "auto",
    });
    const result = await unbindProject(h.deps, {
      projectId: "proj_1",
      teamId: "team_eng",
    });
    expect(result.declined).toBe(true);
    expect(h.values.get(KV.autolinkDeclined("proj_1"))).toEqual({ v: 1, at: NOW });
  });

  it("does not record a decline when a manual binding is unbound", async () => {
    const h = harness();
    await bindProject(h.deps, {
      projectId: "proj_1",
      teamId: "team_eng",
      role: "primary",
      origin: "manual",
    });
    const result = await unbindProject(h.deps, {
      projectId: "proj_1",
      teamId: "team_eng",
    });
    expect(result.declined).toBe(false);
    expect(h.values.has(KV.autolinkDeclined("proj_1"))).toBe(false);
  });

  it("clears the decline marker on a subsequent manual bind", async () => {
    const h = harness();
    h.values.set(KV.autolinkDeclined("proj_1"), { v: 1, at: NOW - 1 });
    await bindProject(h.deps, {
      projectId: "proj_1",
      teamId: "team_eng",
      role: "primary",
      origin: "manual",
    });
    expect(h.values.has(KV.autolinkDeclined("proj_1"))).toBe(false);
    expect(h.deps.store.bindingsForProject("proj_1")[0]?.origin).toBe("manual");
  });
});
