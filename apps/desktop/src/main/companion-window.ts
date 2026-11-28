import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { app, BrowserWindow, type Rectangle } from "electron";

import type { WindowContext } from "@gram/shell/electron";
import { installCompanion } from "@gram/shell/modules/companion";
import type { ShellIpc } from "@gram/shell/modules/ipc";
import { COMPANION_ARG } from "@gram/shell/preload";

async function urlOnceServerAnswers(appUrl: () => string | undefined): Promise<string> {
  for (;;) {
    const url = appUrl();
    if (url !== undefined) return url;
    await sleep(250);
  }
}

/** The companion window's title, which window manager rules match it by. */
export const TITLE = "Gram companion";

/**
 * Companion mode's own window: small, frameless, transparent and above other windows, loading the
 * companion page on the app's origin, which the main window's boot already signed in. Links leave
 * it through `openLink` as they leave the main window.
 */
export function installCompanionWindow(
  ipc: ShellIpc,
  context: WindowContext,
  appUrl: () => string | undefined,
  log: { warn(details: object, message: string): void },
): void {
  const create = (bounds: Rectangle): BrowserWindow => {
    const win = new BrowserWindow({
      ...bounds,
      title: TITLE,
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
    void urlOnceServerAnswers(appUrl).then((url) => {
      if (!win.isDestroyed()) void win.loadURL(`${new URL(url).origin}/?surface=companion`);
    });
    return win;
  };
  const companion = installCompanion(ipc, {
    create,
    title: TITLE,
    storePath: join(app.getPath("userData"), "companion.json"),
    log: (message, error) => log.warn({ err: error }, message),
  });
  void urlOnceServerAnswers(appUrl).then(() => companion.reopen());
}
