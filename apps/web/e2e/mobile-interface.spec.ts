import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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
  await page.keyboard.press("ControlOrMeta+1");
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

  // Minimal bottom chat bar: only +, the Message input, and Send/Queue. No inline pickers or context ring.
  const plus = toolbar.getByTestId("composer-plus");
  await expect(plus).toBeVisible();
  await expect(toolbar.getByLabel("Message", { exact: true })).toBeVisible();
  await expect(toolbar.getByTestId("send-menu-trigger")).toBeVisible();
  await expect(toolbar.getByRole("combobox", { name: "Model" })).toHaveCount(0);
  await expect(toolbar.getByRole("combobox", { name: "Mode" })).toHaveCount(0);
  await expect(toolbar.getByTestId("usage-ring")).toHaveCount(0);
  await expect(page.getByTestId("since-you-left")).toHaveCount(0);

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
