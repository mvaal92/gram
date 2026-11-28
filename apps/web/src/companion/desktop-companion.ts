import type { DesktopCompanion } from "@gram/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useExternalSync, useSubscription } from "@/lib/effects";
import { sleep } from "@/lib/sleep";

import { followStoredCompanion, useCompanion } from "./companion-store";

const OPEN_THREAD_KEY = "gram.companion.openThread";

/** The desktop app's companion window support, when this page runs in a shell that has it. */
export const desktopCompanion = (): DesktopCompanion | undefined =>
  typeof window === "undefined" ? undefined : window.gram?.companion;

/** This page is the desktop app's companion window, and shows nothing but the companion. */
export const isCompanionWindow = (): boolean => desktopCompanion()?.isWindow === true;

/**
 * Back to the full app. In the companion window that closes it, and the app's window, shown again,
 * opens `threadId` when one is given; elsewhere it turns the mode off in place.
 */
export function leaveCompanion(threadId?: string): void {
  const bridge = desktopCompanion();
  if (bridge?.isWindow !== true) {
    useCompanion.getState().set(false);
    return;
  }
  try {
    if (threadId === undefined) localStorage.removeItem(OPEN_THREAD_KEY);
    else localStorage.setItem(OPEN_THREAD_KEY, threadId);
  } catch {
    return void bridge.close();
  }
  void bridge.close();
}

async function openWhenReady(app: DesktopCompanion): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await app.open();
      return;
    } catch (error) {
      if (attempt === 19) console.error("companion: open", error);
      await sleep(500);
    }
  }
}

const takeOpenThread = (): string | undefined => {
  try {
    const id = localStorage.getItem(OPEN_THREAD_KEY);
    localStorage.removeItem(OPEN_THREAD_KEY);
    return id ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * In the desktop app's own window: companion mode opens the companion window, which hides this
 * one, and the mode ends when that window closes, opening the thread it asked for. It keeps what
 * the companion window saved (sizes, opacity, dismissals), so ending the mode never writes back a
 * stale copy.
 */
export function useDesktopCompanionSync(): void {
  const on = useCompanion((s) => s.on);
  const navigate = useNavigate();
  const bridge = desktopCompanion();
  const app = bridge !== undefined && !bridge.isWindow ? bridge : undefined;
  useExternalSync(() => {
    if (app !== undefined && on) void openWhenReady(app);
  }, [app, on]);
  useSubscription(() => (app === undefined ? undefined : followStoredCompanion()), [app]);
  useSubscription(
    () =>
      app?.onClosed(() => {
        void useCompanion.persist.rehydrate().then(() => {
          useCompanion.getState().set(false);
          const threadId = takeOpenThread();
          if (threadId !== undefined) void navigate({ to: "/t/$threadId", params: { threadId } });
        });
      }),
    [app, navigate],
  );
}
