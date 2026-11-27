import { expect, test } from "@playwright/test";

// Companion mode: the whole window becomes one avatar and its bubble, a message from the bubble
// reaches the thread itself, and the same keys bring the full app back with the message in it.

test("the shortcut swaps the app for the avatar, the bubble sends to the thread, and back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
  await expect(page.getByTestId("companion-bubble")).toHaveCount(0);

  await page.getByTestId("companion-avatar").click();
  const bubble = page.getByTestId("companion-bubble");
  await expect(bubble).toBeVisible();
  await bubble.getByLabel("Message the orchestrator").fill("Companion says hello");
  await bubble.getByLabel("Message the orchestrator").press("Enter");
  await expect(bubble.getByText("Companion says hello")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("companion")).toHaveCount(0);
  await expect(
    page.getByTestId("message-user").filter({ hasText: "Companion says hello" }),
  ).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.reload();
  await expect(page.getByTestId("companion-avatar")).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
});
