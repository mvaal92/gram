import type { DocId, MockCardData, QuestionChoice, ThreadId, WorkspaceId } from "@gram/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_DOCK, readDock, type Dock } from "./companion-position";

/** What the companion's sheet holds: a doc to read, a mock to look at and pick from, or a question's pictures. */
export type CompanionSheet =
  | {
      readonly kind: "doc";
      readonly workspaceId: WorkspaceId;
      readonly id: DocId;
      readonly title: string;
    }
  | { readonly kind: "mock"; readonly threadId: ThreadId; readonly mock: MockCardData }
  | { readonly kind: "decide"; readonly start?: string }
  | {
      readonly kind: "choices";
      readonly threadId: ThreadId;
      readonly title: string;
      readonly askKey: string;
      readonly options: readonly QuestionChoice[];
    };

/** A surface the person sized by its free corner, in CSS pixels. */
export interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

/** The surfaces that keep a size: the chat, and the sheet the decision view shares. */
export type SizedSurface = "chat" | "sheet";

const readSize = (value: unknown): SurfaceSize | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const { width, height } = value as { width?: unknown; height?: unknown };
  return typeof width === "number" && typeof height === "number" && width > 0 && height > 0
    ? { width: Math.round(width), height: Math.round(height) }
    : undefined;
};

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
  /** The sheet grown out of the companion's corner, over its dropdown. */
  readonly sheet: CompanionSheet | undefined;
  /** Sizes set by dragging a surface's free corner; absent fits the content. */
  readonly sizes: Partial<Record<SizedSurface, SurfaceSize>>;
  /** Blocked or failed tasks the person put away, by their ending, so a new failure shows again. */
  readonly dismissed: readonly string[];
  dismiss(key: string): void;
  setSize(surface: SizedSurface, size: SurfaceSize | undefined): void;
  showSheet(sheet: CompanionSheet | undefined): void;
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
 * starts keep running behind it, and turning it off shows the same app as before.
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
      sheet: undefined,
      sizes: {},
      dismissed: [],
      dismiss: (key) =>
        set((s) => ({
          dismissed: [...s.dismissed.filter((each) => each !== key), key].slice(-100),
        })),
      setSize: (surface, size) =>
        set((s) => {
          const { [surface]: _gone, ...rest } = s.sizes;
          return { sizes: size === undefined ? rest : { ...rest, [surface]: size } };
        }),
      showSheet: (sheet) => set(sheet === undefined ? { sheet } : { sheet, open: true }),
      set: (on) => set({ on, open: false }),
      toggle: () => set((s) => ({ on: !s.on, open: false })),
      setOpen: (open) => set(open ? { open } : { open, sheet: undefined }),
      setDock: (dock) => set({ dock }),
      setSetupOpen: (setupOpen) => set({ setupOpen }),
      link: ({ workspaceId, skin, pings }) => set({ workspaceId, skin, pings }),
    }),
    {
      name: "gram.companion",
      version: 1,
      storage: createJSONStorage(() => globalThis.localStorage),
      partialize: ({ on, dock, workspaceId, skin, pings, sizes, dismissed }) => ({
        dismissed,
        on,
        dock,
        workspaceId,
        skin,
        pings,
        sizes,
      }),
      merge: (stored, current) => {
        const { on, dock, workspaceId, skin, pings, sizes, dismissed } = (stored ?? {}) as {
          dismissed?: unknown;
          on?: unknown;
          dock?: unknown;
          workspaceId?: unknown;
          skin?: unknown;
          pings?: unknown;
          sizes?: { chat?: unknown; sheet?: unknown };
        };
        const chat = readSize(sizes?.chat);
        const sheet = readSize(sizes?.sheet);
        return {
          ...current,
          on: on === true,
          dock: readDock(dock),
          ...(typeof workspaceId === "string" ? { workspaceId } : {}),
          skin: typeof skin === "string" ? skin : current.skin,
          pings: pings !== false,
          dismissed: Array.isArray(dismissed)
            ? dismissed.filter((each): each is string => typeof each === "string")
            : [],
          sizes: {
            ...(chat === undefined ? {} : { chat }),
            ...(sheet === undefined ? {} : { sheet }),
          },
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
