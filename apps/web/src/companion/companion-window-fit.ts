import type { CompanionCorner } from "@gram/contracts";
import type { CSSProperties, RefObject } from "react";

import { useSubscription } from "@/lib/effects";

import type { Placement } from "./companion-position";
import { desktopCompanion } from "./desktop-companion";

export const WINDOW_INSET = 12;

export const cornerStyle = ({ vertical, horizontal }: Placement): CSSProperties => ({
  ...(vertical === "below" ? { top: WINDOW_INSET } : { bottom: WINDOW_INSET }),
  ...(horizontal === "end" ? { right: WINDOW_INSET } : { left: WINDOW_INSET }),
});

export const placementAt = (corner: CompanionCorner): Placement => ({
  vertical: corner.startsWith("top") ? "below" : "above",
  horizontal: corner.endsWith("right") ? "end" : "start",
});

export const findPlacement = (windowed: boolean, found: (placement: Placement) => void): void => {
  const bridge = windowed ? desktopCompanion() : undefined;
  if (bridge === undefined) return;
  void bridge.placement().then(
    (corner) => found(placementAt(corner)),
    (error: unknown) => console.error("companion: placement", error),
  );
};

export const cornerOf = ({ vertical, horizontal }: Placement): CompanionCorner =>
  `${vertical === "below" ? "top" : "bottom"}-${horizontal === "end" ? "right" : "left"}`;

export function useWindowFit(
  windowed: boolean,
  anchor: RefObject<HTMLDivElement | null>,
  placement: Placement,
  resting: boolean,
  steady: boolean,
  placed: boolean,
): void {
  useSubscription(() => {
    const root = anchor.current;
    const bridge = desktopCompanion();
    if (!windowed || root === null || bridge === undefined || !placed) return undefined;
    if (resting) {
      bridge.fit({ width: 64, height: 64, corner: cornerOf(placement) });
      return undefined;
    }
    let held = { width: 0, height: 0 };
    const fit = () => {
      window.scrollTo(0, 0);
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      const base = root.getBoundingClientRect();
      for (const element of [
        root,
        ...root.querySelectorAll<HTMLElement>(":scope > *, :scope > .companion-beside > *"),
      ]) {
        const box = layoutBox(element, root, base);
        if (box === undefined) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
      const end = placement.horizontal === "end";
      const below = placement.vertical === "below";
      const size = {
        width: Math.ceil((end ? window.innerWidth - left : right) + WINDOW_INSET),
        height: Math.ceil((below ? bottom : window.innerHeight - top) + WINDOW_INSET),
      };
      if (steady) {
        size.width = Math.max(size.width, held.width);
        size.height = Math.max(size.height, held.height);
        if (size.width === held.width && size.height === held.height) return;
      }
      if (size.width === held.width && size.height === held.height) return;
      held = size;
      bridge.fit({ ...size, corner: cornerOf(placement) });
    };
    const observer = new ResizeObserver(fit);
    const watch = () => {
      observer.observe(root);
      for (const box of root.querySelectorAll(":scope > *, :scope > .companion-beside > *"))
        observer.observe(box);
      fit();
    };
    const swapped = new MutationObserver(watch);
    swapped.observe(root, { childList: true });
    for (const beside of root.querySelectorAll(":scope > .companion-beside"))
      swapped.observe(beside, { childList: true });
    watch();
    return () => {
      observer.disconnect();
      swapped.disconnect();
    };
  }, [windowed, anchor, placement, resting, steady, placed]);
}

const layoutBox = (element: HTMLElement, root: HTMLElement, base: DOMRect) => {
  if (element.offsetWidth === 0 && element.offsetHeight === 0) return undefined;
  let x = 0;
  let y = 0;
  let node: Element | null = element;
  while (node instanceof HTMLElement && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent;
  }
  const left = element === root ? base.left : base.left + x;
  const top = element === root ? base.top : base.top + y;
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
};
