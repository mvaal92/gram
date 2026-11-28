import { join } from "node:path";

import { app, BrowserWindow, type Rectangle } from "electron";

import type { WindowContext } from "@gram/shell/electron";
import { installCompanion } from "@gram/shell/modules/companion";
import type { ShellIpc } from "@gram/shell/modules/ipc";
import { COMPANION_ARG } from "@gram/shell/preload";

/**
 * Companion mode's own window: small, frameless, transparent and above other windows, loading the
 * companion page on the app's origin, which the main window's boot already signed in. Links leave
 * it through `openLink` as they leave the main window.
 */
export function installCompanionWindow(
  ipc: ShellIpc,
  context: WindowContext,
  appUrl: () => string | undefined,
): void {
  const create = (bounds: Rectangle): BrowserWindow => {
    const win = new BrowserWindow({
      ...bounds,
      title: "Gram companion",
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: context.preloadPath,
        additionalArguments: [COMPANION_ARG],
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    win.setAlwaysOnTop(true, "floating");
    win.on("page-title-updated", (event) => event.preventDefault());
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    win.webContents.setWindowOpenHandler(({ url }) => {
      void context.openLink(url, win);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, target) => {
      const from = win.webContents.getURL();
      if (from !== "" && new URL(target).origin === new URL(from).origin) return;
      event.preventDefault();
      void context.openLink(target, win);
    });
    const url = appUrl();
    if (url !== undefined) void win.loadURL(`${new URL(url).origin}/?surface=companion`);
    return win;
  };
  installCompanion(ipc, { create, storePath: join(app.getPath("userData"), "companion.json") });
}
