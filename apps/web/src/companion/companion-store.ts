import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface CompanionState {
  /** The whole window is the companion: one avatar and its bubble, nothing else of Gram's. */
  readonly on: boolean;
  /** The bubble is open beside the avatar. */
  readonly open: boolean;
  set(on: boolean): void;
  toggle(): void;
  setOpen(open: boolean): void;
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
      set: (on) => set({ on, open: false }),
      toggle: () => set((s) => ({ on: !s.on, open: false })),
      setOpen: (open) => set({ open }),
    }),
    {
      name: "gram.companion",
      version: 1,
      storage: createJSONStorage(() => globalThis.localStorage),
      partialize: ({ on }) => ({ on }),
    },
  ),
);
