import { expect, test, type Locator } from "@playwright/test";

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

test("setup links a new orchestrator, turns the companion on and keeps the link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();

  await page.getByTestId("companion-enter").click();
  const setup = page.getByTestId("companion-setup");
  await expect(setup).toBeVisible();
  await setup.getByTestId("companion-setup-new").click();
  await setup.getByTestId("companion-setup-name").fill("Companion e2e");
  await setup.getByTestId("companion-setup-on").click();

  await expect(page.getByTestId("app-shell")).toHaveCount(0);
  await page.getByTestId("companion-avatar").click();
  await expect(page.getByLabel("Message the orchestrator")).toBeVisible();

  const linked = await page.evaluate(
    () =>
      (
        JSON.parse(localStorage.getItem("gram.companion") ?? "{}") as {
          state?: { workspaceId?: string };
        }
      ).state?.workspaceId,
  );
  expect(linked).toBeTruthy();
  await page.reload();
  await page.getByTestId("companion-avatar").click();
  await expect(page.getByLabel("Message the orchestrator")).toBeVisible();
});

test("files attach from the + button and from a drop on the icon, as chips, and send", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");

  const avatar = page.getByTestId("companion-avatar");
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["dropped"], "dropped.txt", { type: "text/plain" }));
    return transfer;
  });
  await avatar.dispatchEvent("dragenter", { dataTransfer: dropped });
  await expect(avatar).toHaveAttribute("data-file-over", "true");
  await avatar.dispatchEvent("drop", { dataTransfer: dropped });
  const bubble = page.getByTestId("companion-bubble");
  await expect(bubble).toBeVisible();
  await expect(avatar).not.toHaveAttribute("data-file-over", "true");
  await expect(bubble.getByTestId("attachment-chip")).toHaveCount(1);

  await bubble.getByTestId("companion-file-input").setInputFiles({
    name: "picked.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("picked"),
  });
  const chips = bubble.getByTestId("attachment-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(1)).toHaveAttribute("data-status", "ready");
  await bubble.getByRole("button", { name: "Send" }).click();
  await expect(chips).toHaveCount(0);
});

test("the chat holds only messages; tasks and the plan open over it from the top line", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("gram.mock.orchestration", "realistic"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.getByTestId("companion-avatar").click();
  const bubble = page.getByTestId("companion-bubble");
  await expect(bubble).toBeVisible();
  await expect(bubble.getByTestId("companion-history")).toBeVisible();
  await expect(bubble.getByTestId("companion-task")).toHaveCount(0);
  await expect(bubble.getByTestId("companion-peek")).toHaveCount(0);

  const line = bubble.getByTestId("companion-topline");
  await line.hover();
  const peek = bubble.getByTestId("companion-peek");
  await expect(peek).toBeVisible();
  const history = await bubble.getByTestId("companion-history").boundingBox();
  await expect(peek.getByTestId("companion-task").first()).toBeVisible();
  expect(await bubble.getByTestId("companion-history").boundingBox()).toEqual(history);

  await peek.getByTestId("companion-task").first().click();
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await expect(page).toHaveURL(/\/t\//);
});

test("a shared mock is a compact card that opens in the sheet, and Pick sends the choice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.evaluate(() =>
    window.gramMock!.simulateMessage(
      "t-flaky" as never,
      {
        id: "m-companion-mock",
        role: "assistant",
        parts: [
          { type: "text", text: "Two directions for the empty state." },
          {
            type: "data-mock",
            id: "companion-mock-1",
            data: {
              title: "Empty state",
              version: 2,
              page: "/tmp/mock/v2.html",
              directions: [
                { name: "Quiet", shots: {} },
                { name: "Guided", shots: {} },
              ],
            },
          },
        ],
      } as never,
    ),
  );
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.getByTestId("companion-avatar").click();
  const card = page.getByTestId("companion-card").filter({ hasText: "Empty state" });
  await expect(card).toHaveAttribute("data-kind", "mock");
  await card.click();
  const sheet = page.getByTestId("companion-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("companion-bubble")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Pick this" }).nth(1).click();
  await expect(sheet).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await expect(page.getByText('Go with the "Guided" direction').first()).toBeVisible();
});

test("asks open a decision view in place of the chat, step one by one, and answer in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.getByTestId("companion-avatar").click();
  const asks = page.getByTestId("companion-asks");
  await expect(asks).toBeVisible();
  await asks.click();

  const decide = page.getByTestId("companion-decide");
  await expect(decide).toBeVisible();
  await expect(page.getByTestId("companion-bubble")).toHaveCount(0);
  const position = decide.getByTestId("companion-decide-position");
  await expect(position).toHaveText(/^1 of \d+$/);
  await decide.getByRole("button", { name: "Next" }).click();
  await expect(position).toHaveText(/^2 of \d+$/);
  await decide.getByRole("button", { name: "Previous" }).click();
  const title = await decide.getByTestId("companion-decide-title").textContent();
  await decide.getByTestId("companion-decide-option").first().click();
  await expect(position).toHaveText(/^1 of \d+$/);
  await expect(decide.getByTestId("companion-decide-title")).not.toHaveText(title ?? "");

  await decide.getByRole("button", { name: "Back to the chat" }).click();
  await expect(page.getByTestId("companion-bubble")).toBeVisible();
  await expect(asks).toBeVisible();
});

test("a drag whose release never arrives ends on blur or a buttonless move, never stays held", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");
  const anchor = page.getByTestId("companion-anchor");
  const box = (await page.getByTestId("companion-avatar").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 60, { steps: 6 });
  await expect(anchor).toHaveAttribute("data-dragging", "true");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(anchor).not.toHaveAttribute("data-dragging", "true");
  await page.mouse.up();

  const again = (await page.getByTestId("companion-avatar").boundingBox())!;
  const ax = again.x + again.width / 2;
  const ay = again.y + again.height / 2;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax - 60, ay + 60, { steps: 6 });
  await expect(anchor).toHaveAttribute("data-dragging", "true");
  await page.getByTestId("companion-avatar").dispatchEvent("pointermove", {
    pointerId: 1,
    pointerType: "mouse",
    buttons: 0,
    clientX: ax - 70,
    clientY: ay + 70,
  });
  await expect(anchor).not.toHaveAttribute("data-dragging", "true");
  await page.mouse.up();
});

/** Waits until the element's box holds still for ten frames: loaded, laid out and done animating. */
const settled = (locator: Locator) =>
  locator.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        let last = "";
        let still = 0;
        const check = () => {
          const box = element.getBoundingClientRect();
          const now = `${box.x},${box.y},${box.width},${box.height}`;
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 10) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
  );

test("the chat resizes from its free corner, keeps the size after a reload, and a double-click fits it again", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-docs");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");
  await page.getByTestId("companion-avatar").click();
  const bubble = page.getByTestId("companion-bubble");
  await expect(bubble).toBeVisible();
  await settled(bubble);
  const before = (await bubble.boundingBox())!;
  const handle = bubble.getByTestId("companion-resize");
  await handle.hover();
  const grip = (await handle.boundingBox())!;
  const gx = grip.x + grip.width / 2;
  const gy = grip.y + grip.height / 2;
  const pressed = (await bubble.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(gx - 80, gy + 60, { steps: 8 });
  await page.mouse.up();
  const after = (await bubble.boundingBox())!;
  expect(after.width).toBeGreaterThan(pressed.width + 60);
  expect(Math.abs(after.x + after.width - (pressed.x + pressed.width))).toBeLessThan(2);

  await page.reload();
  await page.getByTestId("companion-avatar").click();
  await expect(bubble).toBeVisible();
  await settled(bubble);
  const kept = (await bubble.boundingBox())!;
  expect(Math.abs(kept.width - after.width)).toBeLessThan(2);
  expect(Math.abs(kept.height - after.height)).toBeLessThan(2);

  await bubble.getByTestId("companion-resize").dblclick();
  await expect
    .poll(async () => Math.round((await bubble.boundingBox())!.width))
    .toBe(Math.round(before.width));
});

test("a right-click on the icon opens Customize; the background opacity applies as it moves and is kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/t/t-flaky");
  await expect(page.getByTestId("app-shell")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Alt+6");

  const avatar = page.getByTestId("companion-avatar");
  await avatar.click({ button: "right" });
  const customize = page.getByTestId("companion-customize");
  await expect(customize).toBeVisible();
  await expect(page.getByTestId("companion-bubble")).toHaveCount(0);

  const backdrop = () =>
    page.evaluate(() => document.documentElement.style.getPropertyValue("--companion-backdrop"));
  await expect(customize.getByText("58%")).toBeVisible();
  await page.getByTestId("companion-backdrop").fill("0.35");
  await expect(customize.getByText("35%")).toBeVisible();
  await expect.poll(backdrop).toBe("35%");

  await page.reload();
  await expect.poll(backdrop).toBe("35%");
  await avatar.click({ button: "right" });
  await expect(customize.getByText("35%")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(customize).toHaveCount(0);
  await avatar.click({ button: "right" });
  await avatar.click();
  await expect(customize).toHaveCount(0);
  await expect(page.getByTestId("companion-bubble")).toBeVisible();

  await avatar.click({ button: "right" });
  await page.getByTestId("companion-reset-backdrop").click();
  await expect(customize.getByText("58%")).toBeVisible();
  await expect.poll(backdrop).toBe("");
  await expect(page.getByTestId("companion-reset-backdrop")).toBeDisabled();
});
