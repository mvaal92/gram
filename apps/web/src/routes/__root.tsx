import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { useCompanion } from "@/companion/companion-store";
import {
  desktopCompanion,
  isCompanionWindow,
  useDesktopCompanionSync,
} from "@/companion/desktop-companion";
import { ThemeRoot } from "@/components/theme-root";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NeedsYouSource } from "@/orchestration/use-needs-you";
import { AppOverlays } from "@/shell/app-overlays";
import { AppShell } from "@/shell/app-shell";
import { usePreloadAfterPaint } from "@/shell/preload-after-paint";
import { useAppLifecycle, useCompanionWindowLifecycle } from "@/shell/use-app-lifecycle";

export interface RouterContext {
  queryClient: QueryClient;
}

const CompanionShell = lazy(() =>
  import("@/companion/companion-shell").then((m) => ({ default: m.CompanionShell })),
);

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return isCompanionWindow() ? <CompanionWindowRoot /> : <AppRoot />;
}

function CompanionWindowRoot() {
  useCompanionWindowLifecycle();
  return (
    <ThemeRoot>
      <TooltipProvider>
        <NeedsYouSource />
        <Suspense fallback={null}>
          <CompanionShell windowed />
        </Suspense>
      </TooltipProvider>
    </ThemeRoot>
  );
}

function AppRoot() {
  useAppLifecycle();
  usePreloadAfterPaint();
  const companion = useCompanion((s) => s.on);
  useDesktopCompanionSync();
  const inPlace = companion && desktopCompanion() === undefined;

  return (
    <ThemeRoot>
      <TooltipProvider>
        <NeedsYouSource />
        {inPlace ? (
          <Suspense fallback={null}>
            <CompanionShell />
          </Suspense>
        ) : (
          <AppShell />
        )}
        <AppOverlays />
      </TooltipProvider>
    </ThemeRoot>
  );
}
