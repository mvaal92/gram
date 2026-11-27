import { describe, expect, it } from "vitest";

import { DEFAULT_DOCK, dockPoint, placementOf, readDock, snapDock } from "./companion-position";

const area = { width: 1000, height: 600 };

describe("snapDock", () => {
  it("lands on the nearest edge and comes back to the same place", () => {
    const dock = snapDock({ x: 20, y: 300 }, area);
    expect(dock.edge).toBe("left");
    const again = snapDock(dockPoint(dock, area), area);
    expect(again).toEqual(dock);
  });

  it("pulls a drop near a corner into it", () => {
    expect(dockPoint(snapDock({ x: 950, y: 20 }, area), area)).toEqual({ x: 944, y: 16 });
    expect(snapDock({ x: 30, y: 545 }, area)).toEqual({ edge: "bottom", t: 0 });
  });

  it("keeps a dock on screen after the window shrinks", () => {
    const point = dockPoint({ edge: "right", t: 1 }, { width: 300, height: 200 });
    expect(point.x).toBeLessThanOrEqual(300 - 40);
    expect(point.y).toBeLessThanOrEqual(200 - 40);
  });
});

describe("placementOf", () => {
  it("opens away from its edge, toward the middle", () => {
    expect(placementOf({ edge: "top", t: 1 })).toEqual({ vertical: "below", horizontal: "end" });
    expect(placementOf({ edge: "left", t: 0.9 })).toEqual({
      vertical: "above",
      horizontal: "start",
    });
  });
});

describe("readDock", () => {
  it("falls back to the default for anything stored that isn't a dock", () => {
    expect(readDock({ edge: "middle", t: 0.5 })).toEqual(DEFAULT_DOCK);
    expect(readDock({ edge: "left", t: Number.NaN })).toEqual(DEFAULT_DOCK);
    expect(readDock({ edge: "left", t: 4 })).toEqual({ edge: "left", t: 1 });
  });
});
