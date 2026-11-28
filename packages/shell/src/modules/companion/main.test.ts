/* oxlint-disable anti-slop/no-module-mocking -- Electron runs only inside its own binary, so the test stands in for it */
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const windows: object[] = [];
const AREA = { x: 0, y: 0, width: 1920, height: 1080 };
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => windows, getFocusedWindow: () => null },
  app: { on: () => undefined },
  screen: {
    getPrimaryDisplay: () => ({ workArea: AREA }),
    getAllDisplays: () => [{ workArea: AREA }],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  },
}));

const { installCompanion } = await import("./main.ts");
const { Channels } = await import("../../channels.ts");

const appWindow = () => {
  let visible = true;
  return {
    webContents: { isDestroyed: () => false, send: vi.fn() },
    isDestroyed: () => false,
    isVisible: () => visible,
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
    focus: () => undefined,
    isResizable: () => true,
    setResizable: () => undefined,
    shown: () => visible,
  };
};

const companionWindow = () => {
  const events = new EventEmitter();
  let bounds = { x: 100, y: 100, width: 64, height: 64 };
  let destroyed = false;
  return {
    webContents: Object.assign(new EventEmitter(), { isDestroyed: () => destroyed }),
    once: (name: string, listener: () => void) => events.once(name, listener),
    emit: (name: string) => events.emit(name),
    isDestroyed: () => destroyed,
    showInactive: () => undefined,
    setResizable: () => undefined,
    getBounds: () => bounds,
    getSize: () => [bounds.width, bounds.height],
    setBounds: vi.fn((next: typeof bounds) => {
      bounds = next;
    }),
    setPosition: () => undefined,
    close: () => {
      destroyed = true;
      events.emit("closed");
    },
  };
};

const setUp = () => {
  const on = new Map<string, (event: { sender: object }, arg: unknown) => void>();
  const handle = new Map<string, (arg: unknown, event: { sender: object }) => unknown>();
  const ipc = {
    on: (channel: string, handler: (event: never, arg: unknown) => void) =>
      on.set(channel, handler as never),
    handle: (channel: string, handler: (arg: unknown, event: never) => unknown) =>
      handle.set(channel, handler as never),
  };
  const companion = companionWindow();
  const companionApi = installCompanion(ipc, {
    create: () => companion as never,
    storePath: join(mkdtempSync(join(tmpdir(), "gram-companion-")), "companion.json"),
    title: "Gram companion",
  });
  return { on, handle, companion, companionApi };
};

describe("installCompanion", () => {
  beforeEach(() => {
    windows.length = 0;
    delete process.env["HYPRLAND_INSTANCE_SIGNATURE"];
  });

  it("sizes and moves the window only for the companion's own page", async () => {
    const { on, handle, companion, companionApi } = setUp();
    companionApi.open();
    companion.emit("ready-to-show");
    await vi.waitFor(() => expect(companion.setBounds).toHaveBeenCalled());
    companion.setBounds.mockClear();

    const stranger = { sender: {} };
    on.get(Channels.companionFit)?.(stranger, { width: 400, height: 300, corner: "top-left" });
    await handle.get(Channels.companionMoveBy)?.({ dx: 50, dy: 0 }, stranger);
    expect(companion.setBounds).not.toHaveBeenCalled();

    const own = { sender: companion.webContents };
    on.get(Channels.companionFit)?.(own, { width: 400, height: 300, corner: "top-left" });
    await vi.waitFor(() =>
      expect(companion.setBounds).toHaveBeenCalledWith(
        expect.objectContaining({ width: 400, height: 300 }),
      ),
    );
    expect(companion.setBounds).toHaveBeenCalledTimes(1);
  });

  it("brings back every window it hid when the companion closes", async () => {
    const main = appWindow();
    const second = appWindow();
    windows.push(main, second);
    const { companion, companionApi } = setUp();
    companionApi.open();
    companion.emit("ready-to-show");
    expect([main.shown(), second.shown()]).toEqual([false, false]);
    await companionApi.close();
    expect([main.shown(), second.shown()]).toEqual([true, true]);
  });
});
