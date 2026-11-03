import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { pressFirstWorkspaceKey } from "./thread-row";

const MOCK_SETTINGS_KEY = "gram.mock.settings";
const MEDIA_DIR = process.env["GRAM_MOBILE_MEDIA_DIR"];

const startPhone = async (page: Page, mode: "dark" | "light" = "dark") => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(
    ([key, themeMode]) => {
      localStorage.setItem(
        "gram.theme",
        JSON.stringify({
          state: {
            mode: themeMode,
            palette: themeMode === "light" ? "neutral" : "neutral-dark",
            motion: "off",
          },
        }),
      );
      if (sessionStorage.getItem(key) === null) {
        sessionStorage.setItem(
          key,
          JSON.stringify({
            onboarding: { welcomeSeen: true },
            panel: { open: false },
            appearance: {
              mode: themeMode,
              palette: themeMode === "light" ? "neutral" : "neutral-dark",
              motion: "off",
            },
          }),
        );
      }
    },
    [MOCK_SETTINGS_KEY, mode] as const,
  );
  await page.goto("/t/t-flaky");
  await page.getByLabel("Message", { exact: true }).waitFor();
  const made = await page.evaluate(() => window.gramMock!.simulateOneThread());
  await pressFirstWorkspaceKey(page);
  await expect(page).toHaveURL(new RegExp(`/t/${made.orchestratorThreadId}$`));
  await expect(page.getByTestId("feature-card").first()).toBeVisible();
  return made;
};

const noHorizontalOverflow = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    return el !== null && el.scrollWidth <= el.clientWidth + 1;
  }, selector);

test("on a 390 × 844 phone, the composer shows only +, input and Post, and Show sidebar opens the full overview", async ({
  page,
}) => {
  const made = await startPhone(page);
  const overview = page.getByTestId("overview-sidebar");
  const rail = page.getByTestId("overview-rail");
  const show = page.getByTestId("shell-titlebar").getByTestId("overview-show");
  const toolbar = page.getByTestId("composer-toolbar");

  // Minimal bottom chat bar: only +, the Message input, and Send/Queue. No inline pickers, context ring, or docked AskStack.
  const plus = toolbar.getByTestId("composer-plus");
  await expect(plus).toBeVisible();
  await expect(toolbar.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(toolbar.getByTestId("send-menu-trigger")).toBeVisible();
  await expect(toolbar.getByRole("combobox", { name: "Model" })).toHaveCount(0);
  await expect(toolbar.getByRole("combobox", { name: "Mode" })).toHaveCount(0);
  await expect(toolbar.getByTestId("usage-ring")).toHaveCount(0);
  await expect(page.getByTestId("since-you-left")).toHaveCount(0);
  await expect(page.locator("[data-pane-root]").getByTestId("ask-stack")).toHaveCount(0);

  // Hidden by default at 390 px, with no 30 px sliver beside the chat.
  await expect(overview).toHaveCount(0);
  await expect(rail).toHaveCount(0);
  await expect(show).toBeVisible();
  expect(await noHorizontalOverflow(page, "main")).toBe(true);
  expect(await noHorizontalOverflow(page, '[data-testid="shell-titlebar"]')).toBe(true);

  if (MEDIA_DIR) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-chat-dark.png") });
  }

  // Tapping + opens the additional options menu (Attach, Commands, Mention, Model, Speed, Effort, Mode).
  await plus.click();
  const menu = page.getByTestId("composer-overflow-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId("composer-plus-attach")).toBeVisible();
  await expect(menu.getByTestId("composer-plus-commands")).toBeVisible();
  await expect(menu.getByTestId("composer-plus-mention")).toBeVisible();
  await expect(menu.getByTestId("composer-option-model")).toBeVisible();
  await expect(menu.getByTestId("composer-option-mode")).toBeVisible();

  if (MEDIA_DIR) {
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-plus-menu-dark.png") });
  }
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Focusing the composer to write sizes the shell to the visual viewport (with 16px text-base and
  // enterKeyHint="send" so iOS Safari never auto-zooms) so the chat interface and the OS keyboard
  // each take about half the screen.
  const messageInput = toolbar.getByLabel("Message", { exact: true });
  await expect(messageInput).toHaveAttribute("enterkeyhint", "send");
  await expect(messageInput).toHaveAttribute("autocapitalize", "sentences");
  await expect(messageInput).toHaveCSS("font-size", "16px");
  await messageInput.focus();
  await expect(page.locator("[data-pane-root]")).toHaveAttribute("data-composer-writing", "true");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--visual-viewport-height", "422px");
  });
  const shellBox = (await page.getByTestId("app-shell").boundingBox())!;
  expect(shellBox.height).toBe(422);
  if (MEDIA_DIR) {
    await messageInput.fill("Ship the minimal mobile composer");
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-writing-dark.png") });
    await messageInput.fill("");
  }
  await page.evaluate(() => {
    document.documentElement.style.removeProperty("--visual-viewport-height");
  });
  await messageInput.evaluate((el: HTMLElement) => el.blur());
  await expect(page.locator("[data-pane-root]")).not.toHaveAttribute("data-composer-writing");

  // Tapping Show sidebar opens the full OverviewSidebar at 390 px over the main column.
  await show.click();
  await expect(overview).toBeVisible();
  await expect(rail).toHaveCount(0);
  await expect(page.getByTestId("app-shell")).toHaveAttribute("data-sidebar-expanded", "true");
  const box = (await overview.boundingBox())!;
  expect(box.width).toBe(390);
  expect(await noHorizontalOverflow(page, '[data-testid="overview-sidebar"]')).toBe(true);

  if (MEDIA_DIR) {
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-overview-dark.png") });
  }

  // Tapping a worker row opens that worker and dismisses the overview sheet automatically.
  await overview.locator(`[data-testid="overview-worker"][data-thread-id="${made.live}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/t/${made.live}$`));
  await expect(overview).toHaveCount(0);
  await expect(show).toBeVisible();

  // Tapping Show sidebar and then Settings also dismisses the overview sheet on navigation.
  await show.click();
  await expect(overview).toBeVisible();
  await overview.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(overview).toHaveCount(0);
});

test("on a 390 × 844 phone, the Board stacks feature lines and worker chips without horizontal clipping, and the right panel opens full-width", async ({
  page,
}) => {
  await startPhone(page, "light");
  if (MEDIA_DIR) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-chat-light.png") });
    await page.getByTestId("composer-plus").click();
    await expect(page.getByTestId("composer-overflow-menu")).toBeVisible();
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-plus-menu-light.png") });
    await page.keyboard.press("Escape");
  }

  await page
    .getByRole("radiogroup", { name: "View" })
    .getByRole("radio", { name: /^Board\b/ })
    .click();
  const board = page.getByTestId("rail-board");
  await expect(board).toBeVisible();
  const firstChip = board.getByTestId("rail-worker").first();
  await expect(firstChip).toBeVisible();
  const chipBox = (await firstChip.boundingBox())!;
  // Stacked vertically, each worker chip gets the full mobile row width (> 300 px) instead of ~42 px.
  expect(chipBox.width).toBeGreaterThan(300);
  expect(chipBox.x + chipBox.width).toBeLessThanOrEqual(390);

  if (MEDIA_DIR) {
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-board-light.png") });
  }

  // Switch back to Chat, open a worker thread with a diff, and open the Right Panel over the chat at 390 px.
  await page
    .getByRole("radiogroup", { name: "View" })
    .getByRole("radio", { name: /^Chat\b/ })
    .click();
  await page.getByTestId("shell-titlebar").getByTestId("overview-show").click();
  await page
    .getByTestId("overview-sidebar")
    .locator('[data-testid="overview-solo"][data-thread-id="t-flaky"]')
    .click();
  await expect(page).toHaveURL(/\/t\/t-flaky$/);
  await page.getByRole("button", { name: "Show right panel" }).click();
  const panel = page.getByTestId("right-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("diff-files")).toBeVisible();
  expect((await panel.boundingBox())!.width).toBe(390);

  if (MEDIA_DIR) {
    await page.screenshot({ path: join(MEDIA_DIR, "mobile-panel-light.png") });
  }
});

test("Settings → General → Phone access displays Tailscale readiness states, renders a QR code for pairing, and renames/revokes paired devices", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "gram.theme",
      JSON.stringify({
        state: { mode: "dark", palette: "neutral-dark", motion: "off" },
      }),
    );
    sessionStorage.setItem(
      "gram.mock.settings",
      JSON.stringify({ onboarding: { welcomeSeen: true }, appearance: { motion: "off" } }),
    );
    window.gramMockRemoteStatus = {
      enabled: true,
      origin: "https://macbook.tail123.ts.net:9443",
      port: 4317,
      tailscale: {
        state: "ready",
        version: "1.76.1",
        dnsName: "macbook.tail123.ts.net",
        tailnetName: "tail123.ts.net",
        suggestedOrigin: "https://macbook.tail123.ts.net:9443",
        configuredOrigin: "https://macbook.tail123.ts.net:9443",
        serveConfigured: true,
        funnelEnabled: false,
        loopbackPort: 4317,
        serveCommand: "tailscale serve --bg --https=9443 http://127.0.0.1:4317",
        launchCommand: "GRAM_REMOTE_ORIGIN=https://macbook.tail123.ts.net:9443",
        message: "Ready on https://macbook.tail123.ts.net:9443 over your private tailnet.",
      },
      devices: [
        {
          id: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
          name: "iPhone",
          createdAt: Date.UTC(2026, 10, 3, 18, 15),
          lastSeenAt: Date.UTC(2026, 10, 3, 19, 42),
          expiresAt: Date.UTC(2027, 10, 3, 18, 15),
        },
        {
          id: "f0e9d8c7b6a543211029384756abcdef",
          name: "Android phone",
          createdAt: Date.UTC(2026, 10, 2, 9, 10),
          lastSeenAt: Date.UTC(2026, 10, 3, 14, 5),
          expiresAt: Date.UTC(2027, 10, 2, 9, 10),
        },
      ],
    };
    window.gramMockPairInvitation = {
      url: "https://macbook.tail123.ts.net:9443/remote/connect#pair=" + "a1b2c3d4".repeat(8),
      expiresAt: Date.UTC(2026, 10, 3, 20, 30),
    };
  });

  await page.goto("/settings/general");
  const statusCard = page.getByTestId("tailscale-status-card");
  await expect(statusCard).toBeVisible();
  await expect(page.getByTestId("tailscale-state-badge")).toHaveText("Ready");
  await expect(page.getByTestId("tailscale-status-message")).toContainText(
    "Ready on https://macbook.tail123.ts.net:9443",
  );

  // Show QR code mints and renders the SVG QR code and 24-hour expiry time.
  await page.getByTestId("pair-phone-qr-button").click();
  const qrBox = page.getByTestId("pair-phone-qr");
  await expect(qrBox).toBeVisible();
  await expect(qrBox.getByRole("img", { name: "Phone pairing QR code" })).toBeVisible();
  await expect(page.getByTestId("pair-phone-status")).toHaveText(
    /^Pairing link copied — valid until \d{2}:\d{2}\.$/,
  );

  // Paired devices list shows both devices with 24-hour last-seen times.
  const rows = page.getByTestId("paired-device-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByTestId("paired-device-name")).toHaveText("iPhone");
  await expect(rows.first().getByTestId("paired-device-times")).toHaveText(/Last seen \d{2}:\d{2}/);

  if (MEDIA_DIR) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    await statusCard.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(MEDIA_DIR, "tailscale-settings-qr-dark.png") });
  }

  // Rename the first device.
  await rows.first().getByTestId("paired-device-rename").click();
  const input = rows.first().getByTestId("paired-device-name-input");
  await input.fill("iPhone 16 Pro");
  await rows.first().getByTestId("paired-device-save-name").click();
  await expect(rows.first().getByTestId("paired-device-name")).toHaveText("iPhone 16 Pro");

  // Revoke the second device.
  await rows.nth(1).getByTestId("paired-device-revoke").click();
  await expect(rows).toHaveCount(1);

  // Also verify the notConfigured state guidance when Tailscale is installed but GRAM_REMOTE_ORIGIN is off.
  await page.evaluate(() => {
    window.gramMockRemoteStatus = {
      enabled: false,
      origin: null,
      port: 4317,
      tailscale: {
        state: "notConfigured",
        version: "1.76.1",
        dnsName: "macbook.tail123.ts.net",
        tailnetName: "tail123.ts.net",
        suggestedOrigin: "https://macbook.tail123.ts.net:9443",
        serveConfigured: false,
        funnelEnabled: false,
        loopbackPort: 4317,
        serveCommand: "tailscale serve --bg --https=9443 http://127.0.0.1:4317",
        launchCommand: "GRAM_REMOTE_ORIGIN=https://macbook.tail123.ts.net:9443",
        message:
          "Phone access is off by default. Start Gram with GRAM_REMOTE_ORIGIN=https://macbook.tail123.ts.net:9443 and forward with tailscale serve --bg --https=9443 http://127.0.0.1:4317.",
      },
      devices: [],
    };
  });
  await statusCard.getByRole("button", { name: "Re-check Tailscale" }).click();
  await expect(page.getByTestId("tailscale-state-badge")).toHaveText("Off (opt-in)");
  await expect(statusCard).toContainText("tailscale serve --bg --https=9443 http://127.0.0.1:4317");
  if (MEDIA_DIR) {
    await page.screenshot({ path: join(MEDIA_DIR, "tailscale-settings-optin-dark.png") });
  }
});
