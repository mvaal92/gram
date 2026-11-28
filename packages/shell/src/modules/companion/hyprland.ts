import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { Box } from "./geometry.ts";

const TIMEOUT_MS = 1500;

/** Hyprland's request socket for this session, when the app runs under Hyprland. */
export const hyprlandSocket = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => {
  const signature = env["HYPRLAND_INSTANCE_SIGNATURE"];
  const runtime = env["XDG_RUNTIME_DIR"];
  return signature && runtime ? join(runtime, "hypr", signature, ".socket.sock") : undefined;
};

/** One request to Hyprland's socket, answered or refused within `TIMEOUT_MS`. */
export function hyprlandRequest(socket: string, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const client = connect(socket);
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("hyprland: no answer"));
    }, TIMEOUT_MS);
    client.on("connect", () => client.end(command));
    client.on("data", (chunk: Buffer | string) =>
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk),
    );
    client.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    client.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

interface HyprClient {
  readonly address: string;
  readonly pid: number;
  readonly title: string;
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  readonly floating?: boolean;
  readonly mapped?: boolean;
}

const isNumberPair = (value: unknown): value is readonly [number, number] =>
  Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number");

/** The clients Hyprland lists, as far as placing a window needs them. */
export function readClients(json: string): readonly HyprClient[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const address = "address" in entry ? entry.address : undefined;
    const pid = "pid" in entry ? entry.pid : undefined;
    const title = "title" in entry ? entry.title : undefined;
    const at = "at" in entry ? entry.at : undefined;
    const size = "size" in entry ? entry.size : undefined;
    const floating = "floating" in entry ? entry.floating : undefined;
    const mapped = "mapped" in entry ? entry.mapped : undefined;
    return typeof address === "string" &&
      typeof pid === "number" &&
      typeof title === "string" &&
      isNumberPair(at) &&
      isNumberPair(size)
      ? [
          {
            address,
            pid,
            title,
            at,
            size,
            ...(typeof floating === "boolean" ? { floating } : {}),
            ...(typeof mapped === "boolean" ? { mapped } : {}),
          },
        ]
      : [];
  });
}

const isQuad = (value: unknown): value is readonly [number, number, number, number] =>
  Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number");

/** Each monitor's work area in layout coordinates: its box less what bars reserve. */
export function readWorkAreas(json: string): readonly Box[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const x = "x" in entry ? entry.x : undefined;
    const y = "y" in entry ? entry.y : undefined;
    const width = "width" in entry ? entry.width : undefined;
    const height = "height" in entry ? entry.height : undefined;
    const scale = "scale" in entry ? entry.scale : undefined;
    const reserved = "reserved" in entry ? entry.reserved : undefined;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      return [];
    }
    const factor = typeof scale === "number" && scale > 0 ? scale : 1;
    const [left, top, right, bottom] = isQuad(reserved) ? reserved : [0, 0, 0, 0];
    return [
      {
        x: x + left,
        y: y + top,
        width: Math.round(width / factor) - left - right,
        height: Math.round(height / factor) - top - bottom,
      },
    ];
  });
}

/** The work area holding most of `box`, or the first one. */
export function areaFor(box: Box, areas: readonly Box[]): Box | undefined {
  let best: Box | undefined;
  let bestOverlap = -1;
  for (const area of areas) {
    const w = Math.min(box.x + box.width, area.x + area.width) - Math.max(box.x, area.x);
    const h = Math.min(box.y + box.height, area.y + area.height) - Math.max(box.y, area.y);
    const overlap = Math.max(0, w) * Math.max(0, h);
    if (overlap > bestOverlap) {
      best = area;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * The app's own windows, other than the companion, once Hyprland shows at least one of them:
 * `undefined` while none is shown yet, else the addresses of those it tiles.
 */
export function tiledAppWindows(
  clients: readonly HyprClient[],
  pid: number,
  companionTitle: string,
): readonly string[] | undefined {
  const own = clients.filter(
    (each) => each.pid === pid && each.title !== companionTitle && each.mapped !== false,
  );
  if (own.length === 0) return undefined;
  return own.filter((each) => each.floating === false).map((each) => each.address);
}

/**
 * Floats the app's windows Hyprland tiled as they came back from companion mode, so full Gram
 * opens over the person's layout and never reflows their other windows. Waits up to `timeoutMs`
 * for a window to show.
 */
export async function floatAppWindows(
  socket: string,
  pid: number,
  companionTitle: string,
  timeoutMs = 2000,
): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 50) {
    const tiled = tiledAppWindows(
      readClients(await hyprlandRequest(socket, "j/clients")),
      pid,
      companionTitle,
    );
    if (tiled !== undefined) {
      for (const address of tiled)
        await hyprlandRequest(
          socket,
          `dispatch hl.dsp.window.float({ action = "toggle", window = "address:${address}" })`,
        );
      return;
    }
    await sleep(50);
  }
}

const dispatchMove = (address: string, box: Box): string =>
  `dispatch hl.dsp.window.move({ x = ${Math.round(box.x)}, y = ${Math.round(box.y)}, relative = false, window = "address:${address}" })`;

const dispatchResize = (address: string, box: Box): string =>
  `dispatch hl.dsp.window.resize({ x = ${Math.round(box.width)}, y = ${Math.round(box.height)}, relative = false, window = "address:${address}" })`;

/** Where the pointer is, in layout coordinates. */
export function readCursor(json: string): { readonly x: number; readonly y: number } | undefined {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null) return undefined;
  const x = "x" in value ? value.x : undefined;
  const y = "y" in value ? value.y : undefined;
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

const inside = (point: { readonly x: number; readonly y: number }, box: Box): boolean =>
  point.x >= box.x &&
  point.x < box.x + box.width &&
  point.y >= box.y &&
  point.y < box.y + box.height;

/**
 * Hyprland sends no pointer motion when it moves a window under a still pointer, so the page
 * would hit-test where the pointer was before the move and a click would miss what is under it.
 * Putting the cursor where it already is makes Hyprland send the motion; the pointer doesn't move.
 */
export async function resendPointer(socket: string, box: Box): Promise<void> {
  const cursor = readCursor(await hyprlandRequest(socket, "j/cursorpos"));
  if (cursor === undefined || !inside(cursor, box)) return;
  await hyprlandRequest(
    socket,
    `dispatch hl.dsp.cursor.move({ x = ${Math.round(cursor.x)}, y = ${Math.round(cursor.y)} })`,
  );
}

/**
 * Places a window under Hyprland, where a Wayland app can't place its own: finds the window by
 * the app's process and its title, reads where it is, and moves it. The window sizes itself.
 */
export function hyprlandPlacer(socket: string, pid: number, title: string) {
  const client = async (): Promise<HyprClient | undefined> =>
    readClients(await hyprlandRequest(socket, "j/clients")).find(
      (each) => each.pid === pid && each.title === title,
    );
  return {
    async bounds(): Promise<Box | undefined> {
      const found = await client();
      return found === undefined
        ? undefined
        : { x: found.at[0], y: found.at[1], width: found.size[0], height: found.size[1] };
    },
    async areas(): Promise<readonly Box[]> {
      return readWorkAreas(await hyprlandRequest(socket, "j/monitors"));
    },
    /** Resolves once Hyprland has mapped the window, or after `timeoutMs` without it. */
    async mapped(timeoutMs = 4000): Promise<boolean> {
      for (let waited = 0; waited < timeoutMs; waited += 100) {
        if ((await client()) !== undefined) return true;
        await sleep(100);
      }
      return false;
    },
    /**
     * Puts the window at `box` once Hyprland has taken the size the window just gave itself:
     * Hyprland places a floating window again when its size changes, so a move sent before that
     * is undone.
     */
    async moveTo(box: Box, resend = true): Promise<void> {
      for (let attempt = 0; attempt < 3; attempt++) {
        for (let waited = 0; waited < 600; waited += 30) {
          const found = await client();
          if (found === undefined) return;
          if (found.size[0] === box.width && found.size[1] === box.height) break;
          await sleep(30);
        }
        const found = await client();
        if (found === undefined) return;
        if (found.at[0] === box.x && found.at[1] === box.y) break;
        await hyprlandRequest(socket, dispatchMove(found.address, box));
        await sleep(30);
      }
      if (resend) await resendPointer(socket, box);
    },
    /**
     * Gives the window `box`'s size and place from the compositor's side. Hyprland keeps a window's
     * top-left corner when it resizes it, so a change of height alone moves nothing; a move follows
     * only when the place differs too. `false` when the window is gone.
     */
    async resizeTo(box: Box, resend = true): Promise<boolean> {
      const found = await client();
      if (found === undefined) return false;
      if (found.size[0] !== box.width || found.size[1] !== box.height) {
        await hyprlandRequest(socket, dispatchResize(found.address, box));
        for (let waited = 0; waited < 600; waited += 15) {
          const now = await client();
          if (now === undefined) return false;
          if (now.size[0] === box.width && now.size[1] === box.height) break;
          await sleep(15);
        }
      }
      const now = await client();
      if (now === undefined) return false;
      if (now.at[0] !== box.x || now.at[1] !== box.y)
        await hyprlandRequest(socket, dispatchMove(now.address, box));
      if (resend) await resendPointer(socket, box);
      return true;
    },
    /** Where the pointer is now, in layout coordinates. */
    async cursor(): Promise<{ readonly x: number; readonly y: number } | undefined> {
      return readCursor(await hyprlandRequest(socket, "j/cursorpos"));
    },
    /**
     * A mover for the length of one drag: it finds the window once and then only sends moves,
     * with no reads, size waits or pointer resends in between.
     */
    async dragMover(): Promise<((box: Box) => Promise<void>) | undefined> {
      const found = await client();
      if (found === undefined) return undefined;
      return async (box) => {
        await hyprlandRequest(socket, dispatchMove(found.address, box));
      };
    },
  };
}
