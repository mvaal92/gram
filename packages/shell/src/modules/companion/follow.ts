import type { Box } from "./geometry.ts";

/** How often a drag reads the pointer and moves the window: about once a display frame. */
export const FOLLOW_MS = 8;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface FollowDeps {
  /** Where the pointer is now, in screen coordinates. */
  readonly cursor: () => Promise<Point | undefined>;
  /** Puts the window's top-left at `box`. */
  readonly move: (box: Box) => Promise<void>;
  /** Keeps a target on the screen. */
  readonly clamp: (box: Box) => Box;
  readonly every: (ms: number, tick: () => void) => () => void;
  /**
   * Called once when the pointer hasn't moved for this many ticks: a drag whose release never
   * reached the page (the window moved under the pointer, or focus changed) ends here instead of
   * gluing the window to the pointer.
   */
  readonly still?: { readonly ticks: number; readonly onStill: () => void };
}

/**
 * Moves the window with the pointer for one drag. Each tick reads the pointer and sends the
 * window where the drag puts it: `from` plus how far the pointer has gone since the press. The
 * target is absolute, so nothing adds up, and a tick that finds the last move still in flight is
 * skipped rather than queued, so the window is never behind by more than one move.
 */
export function followPointer(
  from: Box,
  pressedAt: Point,
  deps: FollowDeps,
): { readonly stop: () => Promise<Box> } {
  let last = from;
  let inFlight: Promise<void> | undefined;
  let seen: Point | undefined;
  let stillFor = 0;
  let ended = false;
  const step = async () => {
    const pointer = await deps.cursor();
    if (pointer === undefined) return;
    if (seen !== undefined && seen.x === pointer.x && seen.y === pointer.y) stillFor += 1;
    else stillFor = 0;
    seen = pointer;
    if (deps.still !== undefined && !ended && stillFor >= deps.still.ticks) {
      ended = true;
      deps.still.onStill();
    }
    const target = deps.clamp({
      ...from,
      x: Math.round(from.x + pointer.x - pressedAt.x),
      y: Math.round(from.y + pointer.y - pressedAt.y),
    });
    if (target.x === last.x && target.y === last.y) return;
    last = target;
    await deps.move(target);
  };
  const tick = () => {
    if (inFlight !== undefined) return;
    inFlight = step().finally(() => {
      inFlight = undefined;
    });
  };
  const cancel = deps.every(FOLLOW_MS, tick);
  return {
    stop: async () => {
      cancel();
      await inFlight;
      await step();
      return last;
    },
  };
}
