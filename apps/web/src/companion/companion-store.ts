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
  set(on: boolean): void;
  toggle(): void;
  setOpen(open: boolean): void;
  setDock(dock: Dock): void;
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
      set: (on) => set({ on, open: false }),
      toggle: () => set((s) => ({ on: !s.on, open: false })),
      setOpen: (open) => set({ open }),
      setDock: (dock) => set({ dock }),
    }),
    {
      name: "gram.companion",
      version: 1,
      storage: createJSONStorage(() => globalThis.localStorage),
      partialize: ({ on, dock }) => ({ on, dock }),
      merge: (stored, current) => {
        const { on, dock } = (stored ?? {}) as { on?: unknown; dock?: unknown };
        return { ...current, on: on === true, dock: readDock(dock) };
      },
    },
  ),
);
