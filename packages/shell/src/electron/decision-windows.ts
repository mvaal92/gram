import { BrowserWindow, type WebContents } from "electron";

const decisionWindows = new WeakSet<WebContents>();

export const markDecisionWindow = (contents: WebContents): void => {
  decisionWindows.add(contents);
};

export const isDecisionWindow = (win: { readonly webContents: WebContents }): boolean =>
  decisionWindows.has(win.webContents);

const companionWindows = new WeakSet<WebContents>();

/** The companion window: the app's own page, but never reloaded, hidden or themed with the rest. */
export const markCompanionWindow = (contents: WebContents): void => {
  companionWindows.add(contents);
};

const setApart = (win: { readonly webContents: WebContents }): boolean =>
  isDecisionWindow(win) || companionWindows.has(win.webContents);

/**
 * Every window but the decision windows and the companion window: the ones the app may reload,
 * hide, theme and message.
 */
export const appWindows = (): Array<BrowserWindow> =>
  BrowserWindow.getAllWindows().filter((win) => !setApart(win));

/** The focused window, unless it is a decision window or the companion window. */
export const focusedAppWindow = (): BrowserWindow | null => {
  const win = BrowserWindow.getFocusedWindow();
  return win === null || setApart(win) ? null : win;
};
