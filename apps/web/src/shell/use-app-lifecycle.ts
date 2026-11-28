import { useDraftPresence } from "@/composer/draft-presence";
import { useDesktopBridge } from "@/desktop/use-desktop-bridge";
import { useWindowPlacementsSync } from "@/desktop/use-window-placements";
import { useForgoLandingAway, useRememberOrchestrator } from "@/orchestration/home";
import { useRefreshReviewRequestsOnFocus, useSeedReviewBotRepos } from "@/reviews/review-requests";
import { useRememberSettingsReturn } from "@/settings/leave-settings";
import { useSettingsSync } from "@/settings-sync";
import { useRememberCameFrom } from "@/shell/came-from";
import { useCompanionShortcut, useGlobalShortcuts } from "@/shell/global-shortcuts";
import { useNeedsYouTitle } from "@/shell/use-needs-you-title";
import { useAcknowledgeAttention } from "@/sidebar/use-acknowledge-attention";
import { useServerEvents } from "@/stores/feeds";
import { useUpdateCheckOnLaunch } from "@/updates/use-update-check-on-launch";
import { useViewShortcuts } from "@/views/view-frame";
import { useWhatsNewOnLaunch } from "@/whats-new/use-whats-new-on-launch";

/**
 * What runs for as long as the app does, whatever is on screen: the server's events, settings
 * sync, the desktop bridge, app-wide shortcuts and the launch checks. Their effects run in this
 * order.
 */
/**
 * What the desktop companion window runs: the server's events, settings sync and its own way
 * back. Notifications, menus, the badge, update checks and what's-new stay with the app's window,
 * so nothing happens twice.
 */
export function useCompanionWindowLifecycle(): void {
  useServerEvents();
  useSettingsSync();
  useCompanionShortcut();
}

export function useAppLifecycle(): void {
  useServerEvents();
  useGlobalShortcuts();
  useRememberSettingsReturn();
  useRememberCameFrom();
  useSettingsSync();
  useDesktopBridge();
  useAcknowledgeAttention();
  useRefreshReviewRequestsOnFocus();
  useSeedReviewBotRepos();
  useWindowPlacementsSync();
  useWhatsNewOnLaunch();
  useUpdateCheckOnLaunch();
  useNeedsYouTitle();
  useRememberOrchestrator();
  useForgoLandingAway();
  useViewShortcuts();
  useDraftPresence();
}
