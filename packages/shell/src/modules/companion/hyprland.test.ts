import { describe, expect, it } from "vitest";

import {
  areaFor,
  dispatched,
  hyprlandSocket,
  readClients,
  readCursor,
  readWorkAreas,
  tiledAppWindows,
} from "./hyprland.ts";

const monitors = JSON.stringify([
  { name: "HDMI-A-1", x: 0, y: 0, width: 3840, height: 2160, scale: 1, reserved: [0, 30, 0, 0] },
  { name: "DP-1", x: 3840, y: 0, width: 2880, height: 1800, scale: 1.5, reserved: [0, 0, 0, 0] },
]);

describe("readWorkAreas", () => {
  it("takes reserved bars off and works in layout pixels on a scaled monitor", () => {
    expect(readWorkAreas(monitors)).toEqual([
      { x: 0, y: 30, width: 3840, height: 2130 },
      { x: 3840, y: 0, width: 1920, height: 1200 },
    ]);
  });
});

describe("areaFor", () => {
  it("picks the monitor holding most of the window, and a monitor when it is on none", () => {
    const areas = readWorkAreas(monitors);
    expect(areaFor({ x: 4000, y: 100, width: 64, height: 64 }, areas)).toEqual(areas[1]);
    expect(areaFor({ x: -9000, y: -9000, width: 64, height: 64 }, areas)).toEqual(areas[0]);
  });
});

describe("readClients", () => {
  it("keeps only well-formed clients", () => {
    const json = JSON.stringify([
      { address: "0x1", pid: 7, title: "Gram companion", at: [10, 20], size: [64, 64] },
      { address: "0x2", pid: 7, title: "Gram" },
    ]);
    expect(readClients(json)).toEqual([
      { address: "0x1", pid: 7, title: "Gram companion", at: [10, 20], size: [64, 64] },
    ]);
  });
});

describe("hyprlandSocket", () => {
  it("is the session's request socket, and none outside Hyprland", () => {
    expect(
      hyprlandSocket({ HYPRLAND_INSTANCE_SIGNATURE: "abc", XDG_RUNTIME_DIR: "/run/user/1" }),
    ).toBe("/run/user/1/hypr/abc/.socket.sock");
    expect(hyprlandSocket({ XDG_RUNTIME_DIR: "/run/user/1" })).toBeUndefined();
  });
});

describe("readCursor", () => {
  it("reads the pointer, and nothing from an answer that isn't one", () => {
    expect(readCursor('{"x": 3693, "y": 157}')).toEqual({ x: 3693, y: 157 });
    expect(readCursor('"unknown request"')).toBeUndefined();
  });
});

const client = (address: string, pid: number, title: string, floating: boolean, mapped = true) => ({
  address,
  pid,
  title,
  at: [0, 0],
  size: [800, 600],
  floating,
  mapped,
});

describe("tiledAppWindows", () => {
  it("waits until one of the app's own windows shows, leaving the companion and other apps out", () => {
    const clients = readClients(
      JSON.stringify([
        client("0x1", 7, "Gram companion", true),
        client("0x2", 9, "Editor", false),
        client("0x3", 7, "Gram", false, false),
      ]),
    );
    expect(tiledAppWindows(clients, 7, "Gram companion")).toBeUndefined();
  });

  it("names only the app's windows the compositor tiled", () => {
    const clients = readClients(
      JSON.stringify([
        client("0x1", 7, "Gram companion", false),
        client("0x2", 7, "Gram", false),
        client("0x3", 7, "Gram · settings", true),
        client("0x4", 9, "Editor", false),
      ]),
    );
    expect(tiledAppWindows(clients, 7, "Gram companion")).toEqual(["0x2"]);
  });
});

describe("dispatched", () => {
  it("takes only Hyprland's ok as done, so a refused dispatch falls back to Electron", () => {
    expect(dispatched("ok\n")).toBe(true);
    expect(dispatched("Invalid dispatcher")).toBe(false);
    expect(dispatched("")).toBe(false);
  });
});
