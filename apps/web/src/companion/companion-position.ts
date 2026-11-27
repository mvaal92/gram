export type Edge = "top" | "right" | "bottom" | "left";

/** Where the companion rests: on an edge of the window, a fraction of the way along it. */
export interface Dock {
  readonly edge: Edge;
  /** 0 at the top or left end of the edge, 1 at the bottom or right end. */
  readonly t: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Area {
  readonly width: number;
  readonly height: number;
}

/** Which way its panels open: toward the half of the window with room. */
export interface Placement {
  readonly vertical: "below" | "above";
  readonly horizontal: "start" | "end";
}

export const DEFAULT_DOCK: Dock = { edge: "top", t: 1 };
export const ICON_SIZE = 40;
export const EDGE_GAP = 16;
/** How far a press moves before it is a drag rather than a click, in pixels. */
export const DRAG_THRESHOLD = 4;
const CORNER_PULL = 0.08;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** The top-left of the icon for `dock` in `area`. */
export function dockPoint(dock: Dock, area: Area): Point {
  const spanX = Math.max(0, area.width - 2 * EDGE_GAP - ICON_SIZE);
  const spanY = Math.max(0, area.height - 2 * EDGE_GAP - ICON_SIZE);
  const far = (span: number) => EDGE_GAP + span;
  switch (dock.edge) {
    case "top":
      return { x: EDGE_GAP + dock.t * spanX, y: EDGE_GAP };
    case "bottom":
      return { x: EDGE_GAP + dock.t * spanX, y: far(spanY) };
    case "left":
      return { x: EDGE_GAP, y: EDGE_GAP + dock.t * spanY };
    case "right":
      return { x: far(spanX), y: EDGE_GAP + dock.t * spanY };
  }
}

/**
 * The dock nearest a dropped icon: the closest edge, and how far along it, pulled into the corner
 * when it lands close to one so a corner is easy to hit.
 */
export function snapDock(point: Point, area: Area): Dock {
  const cx = point.x + ICON_SIZE / 2;
  const cy = point.y + ICON_SIZE / 2;
  const distances: readonly [Edge, number][] = [
    ["top", cy],
    ["bottom", area.height - cy],
    ["left", cx],
    ["right", area.width - cx],
  ];
  const [edge] = distances.reduce((best, each) => (each[1] < best[1] ? each : best));
  const along =
    edge === "top" || edge === "bottom"
      ? (point.x - EDGE_GAP) / Math.max(1, area.width - 2 * EDGE_GAP - ICON_SIZE)
      : (point.y - EDGE_GAP) / Math.max(1, area.height - 2 * EDGE_GAP - ICON_SIZE);
  const t = clamp01(along);
  return { edge, t: t < CORNER_PULL ? 0 : t > 1 - CORNER_PULL ? 1 : t };
}

/** Panels open away from the edge and toward the middle of the window. */
export function placementOf(dock: Dock): Placement {
  switch (dock.edge) {
    case "top":
      return { vertical: "below", horizontal: dock.t > 0.5 ? "end" : "start" };
    case "bottom":
      return { vertical: "above", horizontal: dock.t > 0.5 ? "end" : "start" };
    case "left":
      return { vertical: dock.t > 0.5 ? "above" : "below", horizontal: "start" };
    case "right":
      return { vertical: dock.t > 0.5 ? "above" : "below", horizontal: "end" };
  }
}

/** A stored dock, or the default when what was stored isn't one. */
export function readDock(value: unknown): Dock {
  if (typeof value !== "object" || value === null) return DEFAULT_DOCK;
  const { edge, t } = value as { edge?: unknown; t?: unknown };
  return (edge === "top" || edge === "right" || edge === "bottom" || edge === "left") &&
    typeof t === "number" &&
    Number.isFinite(t)
    ? { edge, t: clamp01(t) }
    : DEFAULT_DOCK;
}
