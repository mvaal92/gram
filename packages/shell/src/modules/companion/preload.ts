import type { DesktopBridge } from "@gram/contracts/desktop-bridge";

import { Channels } from "../../channels.ts";
import type { PreloadIpc } from "../../preload.ts";

/** The renderer argument main gives the companion window, so its page knows to be only that. */
export const COMPANION_ARG = "--gram-companion";

/** The companion module's bridge half: companion mode in a small window of its own. */
export const companionPreload = (
  ipc: PreloadIpc,
  argv: readonly string[],
): Pick<DesktopBridge, "companion"> => ({
  companion: {
    isWindow: argv.includes(COMPANION_ARG),
    open: () => ipc.invoke(Channels.companionOpen),
    close: () => ipc.invoke(Channels.companionClose),
    fit: (size) => ipc.send(Channels.companionFit, size),
    moveBy: (delta) => ipc.invoke(Channels.companionMoveBy, delta),
    placement: () => ipc.invoke(Channels.companionPlacement),
    onClosed: (callback) => ipc.subscribe<void>(Channels.companionClosed, () => callback()),
  },
});
