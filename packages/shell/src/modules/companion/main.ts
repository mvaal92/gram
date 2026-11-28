import type { CompanionCorner } from "@gram/contracts/desktop-bridge";
import { readFileSync, writeFileSync } from "node:fs";

import { app, screen, type BrowserWindow, type WebContents } from "electron";

import { Channels } from "../../channels.ts";
import { appWindows, markCompanionWindow } from "../../electron/decision-windows.ts";
import type { ShellIpc } from "../ipc.ts";
import {
  cornerIn,
  iconOf,
  fitBox,
  readFit,
  readPoint,
  readStep,
  RESTING_SIZE,
  startBox,
  within,
  type Box,
} from "./geometry.ts";
import { followPointer, type Point } from "./follow.ts";
import { latestOnly } from "./latest.ts";
import { areaFor, hyprlandPlacer, hyprlandSocket } from "./hyprland.ts";

const DRAG_LIMIT_MS = 30_000;

export interface CompanionDeps {
  /** A frameless, transparent window at `bounds` loading the companion page; not yet shown. */
  readonly create: (bounds: Box) => BrowserWindow;
  /** Where the companion's resting place is kept across launches. */
  readonly storePath: string;
  /** The window's title, which the window manager finds it by. */
  readonly title: string;
  readonly log?: (message: string, error?: unknown) => void;
}

interface Placer {
  mapped(): Promise<unknown>;
  cursor(): Promise<Point | undefined>;
  dragMover(): Promise<((box: Box) => Promise<void>) | undefined>;
  bounds(): Promise<Box | undefined>;
  areas(): Promise<readonly Box[]>;
  set(box: Box): Promise<void>;
}

const electronPlacer = (win: BrowserWindow): Placer => ({
  mapped: () => Promise.resolve(true),
  cursor: () => Promise.resolve(screen.getCursorScreenPoint()),
  dragMover: () =>
    Promise.resolve((box: Box) => {
      if (!win.isDestroyed()) win.setPosition(box.x, box.y);
      return Promise.resolve();
    }),
  bounds: () => Promise.resolve(win.isDestroyed() ? undefined : win.getBounds()),
  areas: () => Promise.resolve(screen.getAllDisplays().map((display) => display.workArea)),
  set: (box) => {
    if (!win.isDestroyed()) win.setBounds(box);
    return Promise.resolve();
  },
});

const compositorOrElectronPlacer = (win: BrowserWindow, title: string): Placer => {
  const socket = process.platform === "linux" ? hyprlandSocket() : undefined;
  if (socket === undefined || process.env["XDG_SESSION_TYPE"] !== "wayland") {
    return electronPlacer(win);
  }
  const hyprland = hyprlandPlacer(socket, process.pid, title);
  const fallback = electronPlacer(win);
  win.setResizable(true);
  return {
    mapped: () => hyprland.mapped(),
    cursor: async () => (await hyprland.cursor()) ?? fallback.cursor(),
    dragMover: async () => (await hyprland.dragMover()) ?? fallback.dragMover(),
    bounds: async () => {
      const at = await hyprland.bounds();
      if (at === undefined || win.isDestroyed()) return fallback.bounds();
      const [width = at.width, height = at.height] = win.getSize();
      return { ...at, width, height };
    },
    areas: async () => {
      const areas = await hyprland.areas();
      return areas.length > 0 ? areas : fallback.areas();
    },
    set: async (box) => {
      if (win.isDestroyed()) return;
      if (await hyprland.resizeTo(box)) return;
      await fallback.set(box);
      await hyprland.moveTo(box);
    },
  };
};

interface Stored {
  readonly box: Box | undefined;
  readonly openAtLastQuit: boolean;
}

const readStored = (path: string): Stored => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    const point = readPoint(value);
    return {
      box:
        point === undefined ? undefined : { ...point, width: RESTING_SIZE, height: RESTING_SIZE },
      openAtLastQuit:
        typeof value === "object" && value !== null && "open" in value && value.open === true,
    };
  } catch {
    return { box: undefined, openAtLastQuit: false };
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

const hideAppWindows = () => {
  for (const each of appWindows()) each.hide();
};

/**
 * Companion mode as its own window. `open` hides the app's windows and shows a small frameless,
 * transparent window holding the companion; closing it, from the page or the window manager,
 * brings them back and tells their pages, while Gram quitting leaves it to open again at the next
 * launch (`reopen`). Only the companion window's own page may size or move it, and every placement
 * runs after the one before it.
 */
export function installCompanion(ipc: ShellIpc, deps: CompanionDeps) {
  let win: BrowserWindow | undefined;
  let placer: Placer | undefined;
  let corner: CompanionCorner = "top-right";
  let queue: Promise<unknown> = Promise.resolve();
  let known: { box: Box; area: Box } | undefined;
  let quitting = false;
  let drag:
    | Promise<{ readonly stop: () => Promise<Box>; readonly area: Box } | undefined>
    | undefined;

  const log = deps.log ?? (() => undefined);
  const live = () => win !== undefined && !win.isDestroyed();
  const own = (sender: WebContents) => live() && sender === win?.webContents;
  const serial = <T>(work: () => Promise<T>): Promise<T | undefined> => {
    const next = queue.then(work, work).catch((error: unknown) => {
      log("companion: placement", error);
      return undefined;
    });
    queue = next;
    return next;
  };

  const where = async (): Promise<{ box: Box; area: Box } | undefined> => {
    if (placer === undefined) return undefined;
    const box = await placer.bounds();
    if (box === undefined) return undefined;
    const area = areaFor(box, await placer.areas());
    if (area !== undefined) known = { box, area };
    return area === undefined ? undefined : { box, area };
  };

  const put = async (box: Box, area: Box) => {
    if (placer === undefined) return;
    await placer.set(box);
    known = { box, area };
  };

  const remember = (open: boolean) => {
    const rest =
      known === undefined
        ? readStored(deps.storePath).box
        : fitBox(known.box, { width: RESTING_SIZE, height: RESTING_SIZE, corner }, known.area);
    try {
      writeFileSync(
        deps.storePath,
        JSON.stringify(rest === undefined ? { open } : { x: rest.x, y: rest.y, open }),
      );
    } catch (error) {
      log("companion: remember", error);
    }
  };

  const place = (stored: Box | undefined) =>
    serial(async () => {
      if (placer === undefined) return;
      await placer.mapped();
      const areas = await placer.areas();
      const now = await placer.bounds();
      const target =
        stored !== undefined
          ? within(stored, areaFor(stored, areas) ?? stored)
          : now === undefined
            ? undefined
            : startBox(areaFor(now, areas) ?? now);
      if (target === undefined) return;
      const area = areaFor(target, areas) ?? target;
      corner = cornerIn(target, area);
      await put(target, area);
      remember(true);
    });

  const open = () => {
    if (win !== undefined && !win.isDestroyed()) {
      win.showInactive();
      hideAppWindows();
      return;
    }
    const stored = readStored(deps.storePath).box;
    const created = deps.create(stored ?? startBox(screen.getPrimaryDisplay().workArea));
    win = created;
    placer = compositorOrElectronPlacer(created, deps.title);
    corner = "top-right";
    known = undefined;
    markCompanionWindow(created.webContents);
    created.once("ready-to-show", () => {
      if (created.isDestroyed()) return;
      created.showInactive();
      void place(stored);
      hideAppWindows();
    });
    created.once("closed", () => {
      void endDrag();
      if (win === created) {
        win = undefined;
        placer = undefined;
      }
      if (quitting) return;
      remember(false);
      restore();
    });
  };

  const close = async () => {
    if (!live()) {
      restore();
      return;
    }
    await serial(where);
    win?.close();
  };

  app.on("before-quit", () => {
    if (quitting) return;
    quitting = true;
    if (live()) remember(true);
  });

  ipc.handle(Channels.companionOpen, () => open());
  ipc.handle(Channels.companionClose, () => close());
  ipc.handle(Channels.companionPlacement, async (_input, event) => {
    if (!own(event.sender)) return corner;
    const at = await serial(where);
    if (at !== undefined) corner = cornerIn(iconOf(at.box, corner), at.area);
    return corner;
  });
  const fit = latestOnly<NonNullable<ReturnType<typeof readFit>>>(
    (run) => void serial(run),
    async (size) => {
      const at = await where();
      if (at === undefined) return;
      await put(fitBox(at.box, size, at.area), at.area);
    },
  );
  ipc.on(Channels.companionFit, (event, input) => {
    const size = readFit(input);
    if (size === undefined || !own(event.sender)) return;
    corner = size.corner;
    fit(size);
  });
  ipc.on(Channels.companionDragStart, (event, input) => {
    const grip = readPoint(input);
    if (grip === undefined || !own(event.sender) || drag !== undefined) return;
    drag = serial(async () => {
      const at = await where();
      if (at === undefined || placer === undefined) return undefined;
      const [mover, areas] = await Promise.all([placer.dragMover(), placer.areas()]);
      if (mover === undefined) return undefined;
      const follow = followPointer(
        at.box,
        { x: at.box.x + grip.x, y: at.box.y + grip.y },
        {
          cursor: () => placer?.cursor() ?? Promise.resolve(undefined),
          move: mover,
          clamp: (box) => within(box, areaFor(box, areas) ?? at.area),
          every: (ms, tick) => {
            const timer = setInterval(tick, ms);
            const limit = setTimeout(() => void endDrag(), DRAG_LIMIT_MS);
            return () => {
              clearInterval(timer);
              clearTimeout(limit);
            };
          },
        },
      );
      return { stop: follow.stop, area: at.area };
    });
  });
  const endDrag = async () => {
    const started = drag;
    if (started === undefined) return;
    const follow = await started;
    drag = undefined;
    if (follow === undefined) return;
    const landed = await follow.stop();
    const area = known === undefined ? follow.area : known.area;
    known = { box: landed, area };
    corner = cornerIn(landed, area);
    remember(true);
  };
  ipc.on(Channels.companionDragEnd, (event) => {
    if (own(event.sender)) void endDrag();
  });
  ipc.handle(Channels.companionMoveBy, async (input, event) => {
    const step = readStep(input);
    if (step === undefined || !own(event.sender)) return;
    await serial(async () => {
      const at = await where();
      if (at === undefined) return;
      await put(
        within({ ...at.box, x: at.box.x + step.dx, y: at.box.y + step.dy }, at.area),
        at.area,
      );
    });
  });

  return {
    open,
    close,
    isOpen: live,
    /** Opens the companion again when it was open as Gram last quit. */
    reopen: () => {
      if (readStored(deps.storePath).openAtLastQuit) open();
    },
  };
}
