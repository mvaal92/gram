import { useSubscription } from "@/lib/effects";
import { Button } from "@/components/ui/button";

import { PEBBLE, WINDOW_GLASS_ALPHA } from "./companion-skin";
import { BACKDROP_RANGE, useCompanion } from "./companion-store";

/** The glass's opacity when the person hasn't picked one: stronger in its own window, over the desktop. */
export const defaultBackdrop = (windowed: boolean): number =>
  windowed ? WINDOW_GLASS_ALPHA : PEBBLE.glass.alpha;

/** The custom property the glass reads the person's opacity from, or nothing to keep the skin's. */
export const backdropStyle = (backdrop: number | undefined): string | undefined =>
  backdrop === undefined ? undefined : `${Math.round(backdrop * 100)}%`;

/**
 * The small popover a right-click on the icon opens: how see-through the glass is, applied as it
 * is dragged and kept, the skin, and putting sized surfaces back to fitting their content.
 */
export function Customize({ windowed }: { windowed: boolean }) {
  const backdrop = useCompanion((s) => s.backdrop);
  const setBackdrop = useCompanion((s) => s.setBackdrop);
  const sized = useCompanion((s) => Object.keys(s.sizes).length > 0);
  const resetSizes = useCompanion((s) => s.resetSizes);
  const close = useCompanion((s) => s.setCustomizing);
  const shown = backdrop ?? defaultBackdrop(windowed);
  const percent = Math.round(shown * 100);

  useSubscription(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <section
      data-testid="companion-customize"
      aria-label="Customize the companion"
      className="companion-glass companion-customize flex w-60 flex-col gap-3 p-3"
    >
      <h2 className="text-meta font-semibold text-muted-foreground">Customize</h2>
      <label className="flex flex-col gap-1.5 text-meta">
        <span className="flex items-baseline justify-between gap-2">
          <span>Background</span>
          <span className="font-mono text-subtle tabular-nums">{percent}%</span>
        </span>
        <input
          type="range"
          data-testid="companion-backdrop"
          min={BACKDROP_RANGE.min}
          max={BACKDROP_RANGE.max}
          step={0.01}
          value={shown}
          aria-valuetext={`${percent} %`}
          onChange={(event) => setBackdrop(Number(event.target.value))}
          className="w-full accent-primary"
        />
      </label>
      <div className="flex items-center justify-between gap-2 text-meta">
        <span>Skin</span>
        <div role="radiogroup" aria-label="Skin" className="flex gap-1">
          <button
            type="button"
            role="radio"
            aria-checked
            className="h-6 rounded-full border border-edge px-2.5 text-meta outline-none focus-visible:focus-ring"
          >
            {PEBBLE.name}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="companion-reset-backdrop"
          disabled={backdrop === undefined}
          onClick={() => setBackdrop(undefined)}
        >
          Default background
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="companion-reset-size"
          disabled={!sized}
          onClick={resetSizes}
        >
          Reset size
        </Button>
      </div>
    </section>
  );
}
