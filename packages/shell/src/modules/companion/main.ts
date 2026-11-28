import type { CompanionCorner } from "@gram/contracts/desktop-bridge";
import { readFileSync, writeFileSync } from "node:fs";

import { screen, type BrowserWindow, type WebContents } from "electron";

import { Channels } from "../../channels.ts";
import { appWindows, markCompanionWindow } from "../../electron/decision-windows.ts";
import type { ShellIpc } from "../ipc.ts";
import {
  fitBox,
  readFit,
  readPoint,
  readStep,
  RESTING_SIZE,
  startBox,
  within,
  type Box,
} from "./geometry.ts";

export interface CompanionDeps {
  /** A frameless, transparent window at `bounds` loading the companion page; not yet shown. */
  readonly create: (bounds: Box) => BrowserWindow;
  /** Where the companion's resting place is kept across launches. */
  readonly storePath: string;
}

const workArea = (box: Box): Box => screen.getDisplayMatching(box).workArea;

const readStored = (path: string): Box | undefined => {
  try {
    const point = readPoint(JSON.parse(readFileSync(path, "utf8")));
    return point === undefined
      ? undefined
      : { ...point, width: RESTING_SIZE, height: RESTING_SIZE };
  } catch {
    return undefined;
  }
};

const restore = () => {
  const windows = appWindows();
  for (const each of windows) {
    if (!each.webContents.isDestroyed()) each.webContents.send(Channels.companionClosed);
  }
  const first = windows[0];
  if (first !== undefined && !first.isDestroyed()) {
    first.show();
    first.focus();
  }
};

/**
 * Companion mode as its own window. `open` hides the app's windows and shows a small frameless,
 * transparent window holding the companion; closing it, from the page or the window manager,
 * brings them back and tells their pages. Only the companion window's own page may size or move it.
 */
export function installCompanion(ipc: ShellIpc, deps: CompanionDeps) {
  let win: BrowserWindow | undefined;
  let corner: CompanionCorner = "top-right";

  const own = (sender: WebContents) =>
    win !== undefined && !win.isDestroyed() && sender === win.webContents;

  const resting = (): Box | undefined => {
    if (win === undefined || win.isDestroyed()) return undefined;
    const bounds = win.getBounds();
    return fitBox(bounds, { width: RESTING_SIZE, height: RESTING_SIZE, corner }, workArea(bounds));
  };

  const remember = () => {
    const box = resting();
    if (box === undefined) return;
    try {
      writeFileSync(deps.storePath, JSON.stringify({ x: box.x, y: box.y }));
    } catch {
      return;
    }
  };

  const open = () => {
    if (win !== undefined && !win.isDestroyed()) {
      win.show();
      return;
    }
    const stored = readStored(deps.storePath);
    const bounds =
      stored === undefined
        ? startBox(screen.getPrimaryDisplay().workArea)
        : within(stored, workArea(stored));
    const created = deps.create(bounds);
    win = created;
    corner = "top-right";
    markCompanionWindow(created.webContents);
    created.once("ready-to-show", () => {
      if (created.isDestroyed()) return;
      created.showInactive();
      for (const each of appWindows()) each.hide();
    });
    created.on("moved", remember);
    created.on("close", remember);
    created.once("closed", () => {
      if (win === created) win = undefined;
      restore();
    });
  };

  const close = () => {
    if (win === undefined || win.isDestroyed()) {
      restore();
      return;
    }
    win.close();
  };

  ipc.handle(Channels.companionOpen, () => open());
  ipc.handle(Channels.companionClose, () => close());
  ipc.on(Channels.companionFit, (event, input) => {
    const size = readFit(input);
    if (size === undefined || !own(event.sender) || win === undefined) return;
    corner = size.corner;
    const bounds = win.getBounds();
    win.setBounds(fitBox(bounds, size, workArea(bounds)));
  });
  ipc.on(Channels.companionMoveBy, (event, input) => {
    const step = readStep(input);
    if (step === undefined || !own(event.sender) || win === undefined) return;
    const bounds = win.getBounds();
    const next = within(
      { ...bounds, x: bounds.x + step.dx, y: bounds.y + step.dy },
      workArea(bounds),
    );
    win.setPosition(next.x, next.y);
  });

  return {
    open,
    close,
    isOpen: () => win !== undefined && !win.isDestroyed(),
  };
}
