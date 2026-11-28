import type { CompanionCorner } from "@gram/contracts/desktop-bridge";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The companion window's size at rest: the icon and its margin. */
export const RESTING_SIZE = 64;
const MAX_SIZE = 640;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** `box` moved inside `area`, whole when it fits and from the top-left when it doesn't. */
export const within = (box: Box, area: Box): Box => ({
  ...box,
  x: clamp(box.x, area.x, area.x + area.width - box.width),
  y: clamp(box.y, area.y, area.y + area.height - box.height),
});

const sizeOf = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(clamp(value, RESTING_SIZE, MAX_SIZE))
    : RESTING_SIZE;

const isCorner = (value: unknown): value is CompanionCorner =>
  value === "top-left" ||
  value === "top-right" ||
  value === "bottom-left" ||
  value === "bottom-right";

/** A fit request as the page sent it, or `undefined` when it isn't one. */
export function readFit(
  input: unknown,
):
  | { readonly width: number; readonly height: number; readonly corner: CompanionCorner }
  | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const corner = "corner" in input ? input.corner : undefined;
  if (!isCorner(corner)) return undefined;
  return {
    width: sizeOf("width" in input ? input.width : undefined),
    height: sizeOf("height" in input ? input.height : undefined),
    corner,
  };
}

/** A drag step as the page sent it, or `undefined`. */
export function readStep(input: unknown): { readonly dx: number; readonly dy: number } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const dx = "dx" in input ? input.dx : undefined;
  const dy = "dy" in input ? input.dy : undefined;
  return typeof dx === "number" &&
    typeof dy === "number" &&
    Number.isFinite(dx) &&
    Number.isFinite(dy)
    ? { dx: Math.round(clamp(dx, -4000, 4000)), dy: Math.round(clamp(dy, -4000, 4000)) }
    : undefined;
}

/** A stored point, or `undefined`. */
export function readPoint(input: unknown): { readonly x: number; readonly y: number } | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const x = "x" in input ? input.x : undefined;
  const y = "y" in input ? input.y : undefined;
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : undefined;
}

/** `current` resized to `width` × `height` with `corner` held still, kept inside `area`. */
export function fitBox(
  current: Box,
  size: { readonly width: number; readonly height: number; readonly corner: CompanionCorner },
  area: Box,
): Box {
  const right = size.corner.endsWith("right");
  const bottom = size.corner.startsWith("bottom");
  return within(
    {
      x: right ? current.x + current.width - size.width : current.x,
      y: bottom ? current.y + current.height - size.height : current.y,
      width: size.width,
      height: size.height,
    },
    area,
  );
}

/** Where the companion first shows: the top-right of `area`, inset a little. */
export const startBox = (area: Box): Box => ({
  x: area.x + area.width - RESTING_SIZE - 16,
  y: area.y + 16,
  width: RESTING_SIZE,
  height: RESTING_SIZE,
});

/** The corner of `area` that `box` sits nearest: where the icon goes, so the window grows inward. */
export const cornerIn = (box: Box, area: Box): CompanionCorner => {
  const right = box.x + box.width / 2 > area.x + area.width / 2;
  const bottom = box.y + box.height / 2 > area.y + area.height / 2;
  return `${bottom ? "bottom" : "top"}-${right ? "right" : "left"}`;
};
