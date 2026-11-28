import { describe, expect, it } from "vitest";

import { cornerIn, fitBox, iconOf, readFit, readStep, startBox, within } from "./geometry.ts";

const area = { x: 0, y: 0, width: 1920, height: 1080 };

describe("fitBox", () => {
  it("grows from the held corner and shrinks back to the same place", () => {
    const resting = { x: 1840, y: 16, width: 64, height: 64 };
    const open = fitBox(resting, { width: 360, height: 480, corner: "top-right" }, area);
    expect(open).toEqual({ x: 1544, y: 16, width: 360, height: 480 });
    expect(fitBox(open, { width: 64, height: 64, corner: "top-right" }, area)).toEqual(resting);
  });

  it("keeps a grown window on the display", () => {
    const low = { x: 1840, y: 1000, width: 64, height: 64 };
    const open = fitBox(low, { width: 360, height: 480, corner: "top-right" }, area);
    expect(open.y + open.height).toBeLessThanOrEqual(1080);
  });
});

describe("page input", () => {
  it("refuses what isn't a fit or a step, and bounds what is", () => {
    expect(readFit({ width: 300, height: 300, corner: "middle" })).toBeUndefined();
    expect(readFit({ width: 99_999, height: 1, corner: "top-left" })).toEqual({
      width: 800,
      height: 64,
      corner: "top-left",
    });
    expect(readStep({ dx: Number.NaN, dy: 1 })).toBeUndefined();
    expect(readStep({ dx: 3.4, dy: -2 })).toEqual({ dx: 3, dy: -2 });
  });
});

describe("startBox and within", () => {
  it("starts top-right and pulls a stray window back onto the display", () => {
    expect(startBox(area)).toEqual({ x: 1840, y: 16, width: 64, height: 64 });
    expect(within({ x: -500, y: 5000, width: 64, height: 64 }, area)).toEqual({
      x: 0,
      y: 1016,
      width: 64,
      height: 64,
    });
  });
});

describe("cornerIn", () => {
  it("names the nearest corner of the work area, so panels open toward the middle", () => {
    expect(cornerIn({ x: 1840, y: 16, width: 64, height: 64 }, area)).toBe("top-right");
    expect(cornerIn({ x: 10, y: 1000, width: 64, height: 64 }, area)).toBe("bottom-left");
  });
});

describe("placement by the icon", () => {
  it("opens above an icon in the lower half and below one in the upper half, judged by the icon, not the open window", () => {
    const tall = { x: 1544, y: 16, width: 360, height: 900 };
    expect(cornerIn(iconOf(tall, "top-right"), area)).toBe("top-right");
    const low = { x: 1544, y: 160, width: 360, height: 900 };
    expect(cornerIn(iconOf(low, "bottom-right"), area)).toBe("bottom-right");
    expect(cornerIn({ x: 900, y: 600, width: 64, height: 64 }, area)).toBe("bottom-left");
    expect(cornerIn({ x: 900, y: 400, width: 64, height: 64 }, area)).toBe("top-left");
  });

  it("keeps the icon where it is when the window grows the way its corner says", () => {
    const resting = { x: 1700, y: 900, width: 64, height: 64 };
    const corner = cornerIn(resting, area);
    const open = fitBox(resting, { width: 360, height: 480, corner }, area);
    expect(iconOf(open, corner)).toEqual(resting);
  });
});
