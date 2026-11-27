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
  await expect(bubble.getByLabel("Message the orchestrator")).toHaveValue("");

  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page.getByTestId("companion")).toHaveCount(0);
  await expect(page.getByText("Companion says hello").first()).toBeVisible();

  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.reload();
  await expect(page.getByTestId("companion-avatar")).toBeVisible();
  await expect(page.getByTestId("app-shell")).toHaveCount(0);
});

test("the icon drags to an edge without opening, stays there after a reload, and hovers a hint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");
  const icon = page.getByTestId("companion-avatar");
  await expect(icon).toBeVisible();
  await expect(page.getByTestId("companion-hint")).toHaveCount(0);

  await icon.hover();
  await expect(page.getByTestId("companion-hint")).toBeVisible();

  const box = (await icon.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(400, 500, { steps: 8 });
  await page.mouse.move(30, 560, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("companion-bubble")).toHaveCount(0);
  await expect(page.getByTestId("companion-anchor")).toHaveAttribute("data-edge", "left");

  await page.reload();
  await expect(page.getByTestId("companion-anchor")).toHaveAttribute("data-edge", "left");
  await expect.poll(async () => (await icon.boundingBox())?.x).toBe(16);

  await icon.click();
  await expect(page.getByTestId("companion-bubble")).toBeVisible();
});
