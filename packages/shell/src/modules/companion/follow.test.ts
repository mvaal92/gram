import { describe, expect, it } from "vitest";

import { followPointer, type Point } from "./follow.ts";

const box = { x: 100, y: 100, width: 64, height: 64 };
const press = { x: 132, y: 132 };

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const rig = (holdMoves: boolean) => {
  let pointer: Point = press;
  const ticker: { tick?: () => void } = {};
  const moves: { x: number; y: number }[] = [];
  const pending: (() => void)[] = [];
  const follow = followPointer(box, press, {
    cursor: () => Promise.resolve(pointer),
    move: (target) => {
      moves.push({ x: target.x, y: target.y });
      if (!holdMoves) return Promise.resolve();
      return new Promise<void>((resolve) => pending.push(resolve));
    },
    clamp: (target) => ({ ...target, x: Math.max(0, target.x) }),
    every: (_ms, fn) => {
      ticker.tick = fn;
      return () => undefined;
    },
  });
  return {
    follow,
    moves,
    release: () => pending.splice(0).forEach((resolve) => resolve()),
    to: (x: number, y: number) => {
      pointer = { x, y };
      ticker.tick?.();
    },
  };
};

describe("followPointer", () => {
  it("puts the window where the pointer went from the press, kept on screen, without adding up steps", async () => {
    const { follow, moves, to } = rig(false);
    for (let i = 1; i <= 50; i++) {
      to(press.x - i * 3, press.y + i * 2);
      await flush();
    }
    expect(moves).toContainEqual({ x: 100 - 3 * 20, y: 100 + 2 * 20 });
    expect(await follow.stop()).toMatchObject({ x: 0, y: 200 });
  });

  it("skips ticks while a move is in flight instead of queueing them, and lands on the last", async () => {
    const { follow, moves, to, release } = rig(true);
    for (let i = 1; i <= 10; i++) {
      to(press.x + i * 10, press.y);
      await flush();
    }
    expect(moves).toHaveLength(1);
    release();
    const stopped = follow.stop();
    await flush();
    release();
    expect(await stopped).toMatchObject({ x: 200, y: 100 });
  });
});

describe("a drag whose release never arrives", () => {
  it("ends once the pointer has stood still for the set number of ticks, and only once", async () => {
    let pointer: Point = press;
    let tick: (() => void) | undefined;
    let ends = 0;
    followPointer(box, press, {
      cursor: () => Promise.resolve(pointer),
      move: () => Promise.resolve(),
      clamp: (target) => target,
      every: (_ms, fn) => {
        tick = fn;
        return () => undefined;
      },
      still: { ticks: 3, onStill: () => (ends += 1) },
    });
    const at = async (x: number) => {
      pointer = { x, y: 132 };
      tick?.();
      await flush();
    };
    await at(140);
    await at(150);
    await at(150);
    await at(150);
    expect(ends).toBe(0);
    await at(150);
    expect(ends).toBe(1);
    await at(150);
    await at(150);
    expect(ends).toBe(1);
  });
});
