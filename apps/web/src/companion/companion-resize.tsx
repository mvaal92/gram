import { useRef, type PointerEvent } from "react";

import { useLatest, useSubscription } from "@/lib/effects";
import { nextFrame } from "@/stores/frame-batch";

import { resizedBy, type Placement, type SizeLimits } from "./companion-position";
import { useCompanion, type SizedSurface, type SurfaceSize } from "./companion-store";

const LIMITS: Record<SizedSurface, SizeLimits> = {
  chat: { min: { width: 280, height: 200 }, max: { width: 760, height: 700 } },
  sheet: { min: { width: 360, height: 280 }, max: { width: 760, height: 700 } },
};

const onScreen = (limits: SizeLimits): SizeLimits => ({
  min: limits.min,
  max: {
    width: Math.min(limits.max.width, window.screen.availWidth - 48),
    height: Math.min(limits.max.height, window.screen.availHeight - 140),
  },
});

const placementOf = (element: Element): Placement => {
  const at = element.closest<HTMLElement>("[data-placement]")?.dataset["placement"] ?? "below-end";
  return {
    vertical: at.startsWith("above") ? "above" : "below",
    horizontal: at.endsWith("start") ? "start" : "end",
  };
};

/** The style a surface wears for the size it was given, or none to fit its content. */
export const sizedStyle = (size: SurfaceSize | undefined) =>
  size === undefined
    ? undefined
    : { width: size.width, height: size.height, maxWidth: "none", maxHeight: "none" };

/**
 * The grip at a surface's free corner, the one away from the icon. Dragging it sizes the surface
 * by writing its style once a frame; letting go keeps the size for the next open and restart, and
 * a double-click goes back to fitting the content. The window fits whatever the surface becomes,
 * from the icon's corner, so the icon stays where it is.
 */
export function ResizeGrip({ surface }: { surface: SizedSurface }) {
  const drag = useRef<
    | {
        readonly target: HTMLElement;
        readonly start: { readonly width: number; readonly height: number };
        readonly from: { readonly x: number; readonly y: number };
        readonly placement: Placement;
        readonly limits: SizeLimits;
        size: SurfaceSize;
        frame: (() => void) | undefined;
        pointer: { x: number; y: number };
      }
    | undefined
  >(undefined);

  const apply = (held: NonNullable<typeof drag.current>) => {
    held.size = resizedBy(
      held.start,
      { x: held.pointer.x - held.from.x, y: held.pointer.y - held.from.y },
      held.placement,
      held.limits,
    );
    Object.assign(held.target.style, {
      width: `${held.size.width}px`,
      height: `${held.size.height}px`,
      maxWidth: "none",
      maxHeight: "none",
    });
  };
  const end = () => {
    const held = drag.current;
    drag.current = undefined;
    if (held === undefined) return;
    held.frame?.();
    if (held.pointer.x !== held.from.x || held.pointer.y !== held.from.y) apply(held);
    useCompanion.getState().setSize(surface, held.size);
  };
  const ending = useLatest(end);
  useSubscription(() => {
    const onBlur = () => ending.current();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [ending]);

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    const target = event.currentTarget.parentElement;
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const box = target.getBoundingClientRect();
    const start = { width: Math.round(box.width), height: Math.round(box.height) };
    drag.current = {
      target,
      start,
      from: { x: event.screenX, y: event.screenY },
      placement: placementOf(target),
      limits: onScreen(LIMITS[surface]),
      size: start,
      frame: undefined,
      pointer: { x: event.screenX, y: event.screenY },
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const held = drag.current;
    if (held === undefined) return;
    if ((event.buttons & 1) === 0) return end();
    held.pointer = { x: event.screenX, y: event.screenY };
    if (held.frame !== undefined) return;
    held.frame = nextFrame(() => {
      held.frame = undefined;
      apply(held);
    });
  };
  const onRelease = (event: PointerEvent<HTMLSpanElement>) => {
    if (drag.current !== undefined) drag.current.pointer = { x: event.screenX, y: event.screenY };
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    end();
  };
  return (
    <span
      aria-hidden
      data-testid="companion-resize"
      title="Drag to resize · double-click to fit"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onLostPointerCapture={end}
      onDoubleClick={(event) => {
        const target = event.currentTarget.parentElement;
        if (target !== null)
          Object.assign(target.style, { width: "", height: "", maxWidth: "", maxHeight: "" });
        useCompanion.getState().setSize(surface, undefined);
      }}
      className="companion-resize"
    />
  );
}
