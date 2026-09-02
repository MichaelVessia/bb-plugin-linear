import { z } from "zod";
import { KV, type VersionedStore } from "./kv.js";
import type { BindingOrigin, BindingRole } from "./store/rows.js";

export const autolinkDeclinedSchema = z.object({
  v: z.literal(1),
  at: z.number(),
});

export interface ProjectBindingStore {
  bindingsForProject(projectId: string): readonly {
    readonly teamId: string;
    readonly role: BindingRole;
    readonly origin: BindingOrigin;
  }[];
  setBinding(
    projectId: string,
    teamId: string,
    role: BindingRole,
    at: number,
    origin?: BindingOrigin,
  ): void;
  removeBinding(projectId: string, teamId: string): void;
}

export interface ProjectBindingDeps {
  readonly store: ProjectBindingStore;
  readonly kv: Pick<VersionedStore, "write" | "remove">;
  readonly now: () => number;
}

export async function bindProject(
  deps: ProjectBindingDeps,
  input: {
    readonly projectId: string;
    readonly teamId: string;
    readonly role: BindingRole;
    readonly origin: BindingOrigin;
  },
): Promise<void> {
  deps.store.setBinding(
    input.projectId,
    input.teamId,
    input.role,
    deps.now(),
    input.origin,
  );
  if (input.origin === "manual") {
    await deps.kv.remove(KV.autolinkDeclined(input.projectId));
  }
}

export async function unbindProject(
  deps: ProjectBindingDeps,
  input: { readonly projectId: string; readonly teamId: string },
): Promise<{ readonly declined: boolean }> {
  const binding = deps.store
    .bindingsForProject(input.projectId)
    .find((row) => row.teamId === input.teamId);
  deps.store.removeBinding(input.projectId, input.teamId);

  const declined = binding?.role === "primary" && binding.origin === "auto";
  if (declined) {
    await deps.kv.write(KV.autolinkDeclined(input.projectId), {
      v: 1,
      at: deps.now(),
    });
  }
  return { declined };
}
