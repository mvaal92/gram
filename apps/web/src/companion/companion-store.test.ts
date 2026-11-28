// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { readBackdrop, useCompanion } from "./companion-store";

describe("readBackdrop", () => {
  it("holds a picked opacity to the range and whole percents", () => {
    expect(readBackdrop(0.555)).toBe(0.56);
    expect(readBackdrop(0.05)).toBe(0.4);
    expect(readBackdrop(4)).toBe(1);
  });

  it("treats anything but a number as no choice", () => {
    expect(readBackdrop(undefined)).toBeUndefined();
    expect(readBackdrop("0.5")).toBeUndefined();
    expect(readBackdrop(Number.NaN)).toBeUndefined();
  });
});

describe("customize", () => {
  beforeEach(() => {
    useCompanion.setState({ open: false, customizing: false, sheet: undefined, sizes: {} });
  });

  it("is never open at the same time as the dropdown", () => {
    const companion = useCompanion.getState();
    companion.setOpen(true);
    companion.setCustomizing(true);
    expect(useCompanion.getState()).toMatchObject({ open: false, customizing: true });
    companion.setOpen(true);
    expect(useCompanion.getState()).toMatchObject({ open: true, customizing: false });
  });

  it("keeps the picked opacity across a restart, held to the range", async () => {
    useCompanion.getState().setBackdrop(0.42);
    const saved = JSON.parse(localStorage.getItem("gram.companion") ?? "{}") as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(saved.state["backdrop"]).toBe(0.42);
    localStorage.setItem(
      "gram.companion",
      JSON.stringify({ ...saved, state: { ...saved.state, backdrop: 7 } }),
    );
    await useCompanion.persist.rehydrate();
    expect(useCompanion.getState().backdrop).toBe(1);
  });

  it("puts every sized surface back to fitting its content", () => {
    const companion = useCompanion.getState();
    companion.setSize("chat", { width: 400, height: 300 });
    companion.setSize("sheet", { width: 500, height: 400 });
    companion.resetSizes();
    expect(useCompanion.getState().sizes).toEqual({});
  });
});
