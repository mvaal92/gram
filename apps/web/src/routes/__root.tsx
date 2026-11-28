import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";

import { CompanionShell } from "@/companion/companion-shell";
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
import { useAppLifecycle } from "@/shell/use-app-lifecycle";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  useAppLifecycle();
  usePreloadAfterPaint();
  const companion = useCompanion((s) => s.on);
  useDesktopCompanionSync();
  const windowed = isCompanionWindow();
  const inPlace = companion && desktopCompanion() === undefined;

  return (
    <ThemeRoot>
      <TooltipProvider>
        <NeedsYouSource />
        {windowed ? (
          <CompanionShell windowed />
        ) : (
          <>
            {inPlace ? <CompanionShell /> : <AppShell />}
            <AppOverlays />
          </>
        )}
      </TooltipProvider>
    </ThemeRoot>
  );
}
