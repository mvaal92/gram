import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_DOCK, readDock, type Dock } from "./companion-position";

export interface CompanionState {
  /** The whole window is the companion: one icon and its dropdown, nothing else of Gram's. */
  readonly on: boolean;
  /** The dropdown is open beside the icon. */
  readonly open: boolean;
  /** Where the icon rests, kept across launches. */
  readonly dock: Dock;
  /** The workspace whose orchestrator it talks to, as linked in its setup; absent picks one. */
  readonly workspaceId: string | undefined;
  /** The skin it wears, by id; Pebble is the only one so far. */
  readonly skin: string;
  /** A desktop notification when a task it follows ends. */
  readonly pings: boolean;
  /** The setup dialog is open in full Gram. */
  readonly setupOpen: boolean;
  set(on: boolean): void;
  toggle(): void;
  setOpen(open: boolean): void;
  setDock(dock: Dock): void;
  setSetupOpen(open: boolean): void;
  /** Saves the setup: which orchestrator, which skin, and whether it pings. */
  link(setup: { workspaceId: string; skin: string; pings: boolean }): void;
}

/**
 * Companion mode, kept across launches. Only the window changes: threads, workers and what a host
 * such as Runheim starts keep running behind it, and turning it off shows the same app as before.
 */
export const useCompanion = create<CompanionState>()(
  persist(
    (set) => ({
      on: false,
      open: false,
      dock: DEFAULT_DOCK,
      workspaceId: undefined,
      skin: "pebble",
      pings: true,
      setupOpen: false,
      set: (on) => set({ on, open: false }),
      toggle: () => set((s) => ({ on: !s.on, open: false })),
      setOpen: (open) => set({ open }),
      setDock: (dock) => set({ dock }),
      setSetupOpen: (setupOpen) => set({ setupOpen }),
      link: ({ workspaceId, skin, pings }) => set({ workspaceId, skin, pings }),
    }),
    {
      name: "gram.companion",
      version: 1,
      storage: createJSONStorage(() => globalThis.localStorage),
      partialize: ({ on, dock, workspaceId, skin, pings }) => ({
        on,
        dock,
        workspaceId,
        skin,
        pings,
      }),
      merge: (stored, current) => {
        const { on, dock, workspaceId, skin, pings } = (stored ?? {}) as {
          on?: unknown;
          dock?: unknown;
          workspaceId?: unknown;
          skin?: unknown;
          pings?: unknown;
        };
        return {
          ...current,
          on: on === true,
          dock: readDock(dock),
          ...(typeof workspaceId === "string" ? { workspaceId } : {}),
          skin: typeof skin === "string" ? skin : current.skin,
          pings: pings !== false,
        };
      },
    },
  ),
);

const onStorage = (event: StorageEvent) => {
  if (event.key === "gram.companion") void useCompanion.persist.rehydrate();
};

/** Another window saved the setup: take it, so the companion window follows a link made in full Gram. */
export function followStoredCompanion(): () => void {
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
