import { describe, expect, it } from "vitest";

import { latestOnly } from "./latest.ts";

describe("latestOnly", () => {
  it("runs the newest value after the run under way, never the ones it replaced", async () => {
    const done: number[] = [];
    let release!: () => void;
    let line: Promise<void> = Promise.resolve();
    const enqueue = (run: () => Promise<void>) => {
      line = line.then(run);
    };
    const fit = latestOnly<number>(enqueue, async (value) => {
      if (value === 1) await new Promise<void>((resolve) => (release = resolve));
      done.push(value);
    });
    fit(1);
    await Promise.resolve();
    for (const value of [2, 3, 4, 5]) fit(value);
    release();
    await line;
    await line;
    expect(done).toEqual([1, 5]);
  });
});
