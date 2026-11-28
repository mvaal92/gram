import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCK,
  dockPoint,
  placementOf,
  readDock,
  snapDock,
  resizedBy,
  sizeToPointer,
} from "./companion-position";

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

describe("resizedBy", () => {
  const limits = { min: { width: 280, height: 200 }, max: { width: 760, height: 700 } };
  const start = { width: 340, height: 300 };
  it("grows from the corner away from the icon: down and left for a chat below and left of it", () => {
    expect(
      resizedBy(start, { x: -60, y: 80 }, { vertical: "below", horizontal: "end" }, limits),
    ).toEqual({
      width: 400,
      height: 380,
    });
    expect(
      resizedBy(start, { x: 60, y: -80 }, { vertical: "above", horizontal: "start" }, limits),
    ).toEqual({
      width: 400,
      height: 380,
    });
  });

  it("stays within its limits however far the corner goes", () => {
    expect(
      resizedBy(start, { x: 900, y: -900 }, { vertical: "below", horizontal: "end" }, limits),
    ).toEqual({
      width: 280,
      height: 200,
    });
    expect(
      resizedBy(start, { x: -900, y: 900 }, { vertical: "below", horizontal: "end" }, limits),
    ).toEqual({
      width: 760,
      height: 700,
    });
  });
});

describe("sizeToPointer", () => {
  const limits = { min: { width: 280, height: 200 }, max: { width: 760, height: 700 } };
  it("puts the free corner under the pointer, measured from the icon's side, wherever the page moved", () => {
    const surface = { left: 100, top: 50, right: 440, bottom: 340 };
    expect(
      sizeToPointer(
        surface,
        { x: 40, y: 400 },
        { x: 0, y: 0 },
        { vertical: "below", horizontal: "end" },
        limits,
      ),
    ).toEqual({ width: 400, height: 350 });
    expect(
      sizeToPointer(
        surface,
        { x: 520, y: 0 },
        { x: 0, y: 0 },
        { vertical: "above", horizontal: "start" },
        limits,
      ),
    ).toEqual({ width: 420, height: 340 });
    expect(
      sizeToPointer(
        surface,
        { x: 2000, y: 0 },
        { x: 0, y: 0 },
        { vertical: "below", horizontal: "end" },
        limits,
      ),
    ).toEqual({ width: 280, height: 200 });
  });
});
