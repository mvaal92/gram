/**
 * Runs `work` for the newest value only: while one run is under way, later values wait in a single
 * slot, each replacing the one before, so a burst of requests (a fit per animation frame) never
 * queues up behind itself. `enqueue` puts a run in line with whatever else must not overlap it.
 */
export function latestOnly<T>(
  enqueue: (run: () => Promise<void>) => void,
  work: (value: T) => Promise<void>,
): (value: T) => void {
  let waiting: { readonly value: T } | undefined;
  return (value) => {
    const queued = waiting !== undefined;
    waiting = { value };
    if (queued) return;
    enqueue(async () => {
      const next = waiting;
      waiting = undefined;
      if (next !== undefined) await work(next.value);
    });
  };
}
