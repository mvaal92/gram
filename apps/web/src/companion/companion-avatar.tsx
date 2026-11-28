import { LayoutPanelLeft } from "lucide-react";
import type { CompanionCorner, ThreadId } from "@gram/contracts";
import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useShortcutHint } from "@/keyboard/use-shortcut-hint";
import { useSubscription } from "@/lib/effects";
import { useFlash } from "@/lib/timers";
import { cn } from "@/lib/utils";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useThreadFeed } from "@/stores/feeds";

import {
  activeTool,
  excerpt,
  lastExchange,
  type ActiveTool,
  type AvatarState,
} from "./companion-model";
import {
  DRAG_THRESHOLD,
  EDGE_GAP,
  ICON_SIZE,
  placementOf,
  snapDock,
  type Dock,
  type Placement,
  type Point,
} from "./companion-position";
import { faceOf, PEBBLE, skinStyle } from "./companion-skin";
import { useCompanion } from "./companion-store";
import { desktopCompanion, leaveCompanion } from "./desktop-companion";

const STATE_WORDS: Record<AvatarState, string> = {
  idle: "Gram",
  working: "Gram is working",
  error: "Gram: something failed",
};

const DROP_MS = 9000;

interface Drop {
  readonly key: string;
  readonly tone: "reply" | "needs";
  readonly text: string;
}

/**
 * The companion's icon where the person put it, with what it shows on its own: a hint naming the
 * work under way while it is hovered, a glass drop when a reply lands or something new asks while
 * the dropdown is closed, and the dropdown (`panel`) opened toward the side of the window with room.
 */
export function CompanionPresence({
  threadId,
  state,
  asks,
  busy,
  needs,
  panel,
  windowed = false,
}: {
  threadId: ThreadId | undefined;
  state: AvatarState;
  /** Something waits on the person: the amber mark. */
  asks: boolean;
  /** A running worker's line, for the hint when the companion's own turn names no tool. */
  busy: ActiveTool | undefined;
  needs: readonly NeedsYouItem[];
  panel: ReactNode;
  /** In the desktop app's companion window: dragging moves the window, which fits its content. */
  windowed?: boolean;
}) {
  return threadId === undefined ? (
    <Presence
      state={state}
      asks={asks}
      needs={needs}
      tool={busy}
      reply={undefined}
      loaded
      panel={panel}
      windowed={windowed}
    />
  ) : (
    <ThreadPresence
      threadId={threadId}
      state={state}
      asks={asks}
      busy={busy}
      needs={needs}
      panel={panel}
      windowed={windowed}
    />
  );
}

function ThreadPresence({
  threadId,
  state,
  asks,
  busy,
  needs,
  panel,
  windowed,
}: {
  threadId: ThreadId;
  state: AvatarState;
  asks: boolean;
  busy: ActiveTool | undefined;
  needs: readonly NeedsYouItem[];
  panel: ReactNode;
  windowed: boolean;
}) {
  const messages = useThreadFeed(threadId, (s) => s.messages);
  const own = activeTool(messages);
  const tool = own ?? busy;
  const { reply } = lastExchange(messages);
  const loaded = useThreadFeed(threadId, (s) => s.phase === "live");
  return (
    <Presence
      state={tool !== undefined && state === "idle" ? "working" : state}
      asks={asks}
      needs={needs}
      tool={tool}
      reply={own === undefined && loaded ? reply : undefined}
      loaded={loaded}
      panel={panel}
      windowed={windowed}
    />
  );
}

const dockStyle = ({ edge, t }: Dock): CSSProperties => {
  const along = `calc(${EDGE_GAP}px + ${t} * (100% - ${2 * EDGE_GAP + ICON_SIZE}px))`;
  const far = `calc(100% - ${EDGE_GAP + ICON_SIZE}px)`;
  switch (edge) {
    case "top":
      return { left: along, top: EDGE_GAP };
    case "bottom":
      return { left: along, top: far };
    case "left":
      return { left: EDGE_GAP, top: along };
    case "right":
      return { left: far, top: along };
  }
};

const WINDOW_INSET = 12;

const cornerStyle = ({ vertical, horizontal }: Placement): CSSProperties => ({
  ...(vertical === "below" ? { top: WINDOW_INSET } : { bottom: WINDOW_INSET }),
  ...(horizontal === "end" ? { right: WINDOW_INSET } : { left: WINDOW_INSET }),
});

function screenPlacement(): Placement {
  const { availLeft, availTop, availWidth, availHeight } = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };
  const x = window.screenX + window.innerWidth / 2 - (availLeft ?? 0);
  const y = window.screenY + window.innerHeight / 2 - (availTop ?? 0);
  return {
    vertical: y > availHeight / 2 ? "above" : "below",
    horizontal: x > availWidth / 2 ? "end" : "start",
  };
}

const cornerOf = ({ vertical, horizontal }: Placement): CompanionCorner =>
  `${vertical === "below" ? "top" : "bottom"}-${horizontal === "end" ? "right" : "left"}`;

function useWindowFit(
  windowed: boolean,
  anchor: RefObject<HTMLDivElement | null>,
  placement: Placement,
  resting: boolean,
): void {
  useSubscription(() => {
    const root = anchor.current;
    const bridge = desktopCompanion();
    if (!windowed || root === null || bridge === undefined) return undefined;
    if (resting) {
      bridge.fit({ width: 64, height: 64, corner: cornerOf(placement) });
      return undefined;
    }
    const fit = () => {
      let left = Number.POSITIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const element of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        left = Math.min(left, box.left);
        top = Math.min(top, box.top);
        right = Math.max(right, box.right);
        bottom = Math.max(bottom, box.bottom);
      }
      const end = placement.horizontal === "end";
      const below = placement.vertical === "below";
      bridge.fit({
        width: Math.ceil((end ? window.innerWidth - left : right) + WINDOW_INSET),
        height: Math.ceil((below ? bottom : window.innerHeight - top) + WINDOW_INSET),
        corner: cornerOf(placement),
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(root);
    for (const child of root.children) observer.observe(child);
    root.addEventListener("animationend", fit);
    fit();
    return () => {
      observer.disconnect();
      root.removeEventListener("animationend", fit);
    };
  }, [windowed, anchor, placement, resting]);
}

const besideStyle = ({ vertical, horizontal }: Placement): string =>
  cn(
    "companion-beside absolute flex w-max max-w-[min(22rem,calc(100vw-2rem))] flex-col gap-2",
    vertical === "below" ? "top-full mt-2" : "bottom-full mb-2",
    horizontal === "end" ? "right-0 items-end" : "left-0 items-start",
  );

function Presence({
  state,
  asks,
  needs,
  tool,
  reply,
  loaded,
  panel,
  windowed,
}: {
  state: AvatarState;
  asks: boolean;
  needs: readonly NeedsYouItem[];
  tool: ActiveTool | undefined;
  reply: string | undefined;
  loaded: boolean;
  panel: ReactNode;
  windowed: boolean;
}) {
  const open = useCompanion((s) => s.open);
  const setOpen = useCompanion((s) => s.setOpen);
  const dock = useCompanion((s) => s.dock);
  const setDock = useCompanion((s) => s.setDock);
  const drop = useDrop(open, loaded, reply, needs);
  const [hovered, setHovered] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const press = useRef<{ start: Point; offset: Point; moved: boolean } | undefined>(undefined);
  const [dragging, setDragging] = useState<Point | undefined>(undefined);
  const dragged = useRef(false);
  const [onScreen, setOnScreen] = useState<Placement>(screenPlacement);
  const placement = windowed ? onScreen : placementOf(dock);
  const screenPress = useRef<Point | undefined>(undefined);
  useWindowFit(windowed, anchor, placement, !open && drop.shown === undefined && !hovered);

  const area = () => anchor.current?.parentElement?.getBoundingClientRect();
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    screenPress.current = { x: event.screenX, y: event.screenY };
    const box = anchor.current?.getBoundingClientRect();
    if (box === undefined) return;
    press.current = {
      start: { x: event.clientX, y: event.clientY },
      offset: { x: event.clientX - box.left, y: event.clientY - box.top },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const held = press.current;
    const bounds = area();
    if (held === undefined || bounds === undefined) return;
    const dx = event.clientX - held.start.x;
    const dy = event.clientY - held.start.y;
    if (!held.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    held.moved = true;
    if (windowed) {
      const last = screenPress.current;
      if (last === undefined) return;
      screenPress.current = { x: event.screenX, y: event.screenY };
      desktopCompanion()?.moveBy({ dx: event.screenX - last.x, dy: event.screenY - last.y });
      return;
    }
    setDragging({
      x: Math.min(
        Math.max(0, event.clientX - bounds.left - held.offset.x),
        bounds.width - ICON_SIZE,
      ),
      y: Math.min(
        Math.max(0, event.clientY - bounds.top - held.offset.y),
        bounds.height - ICON_SIZE,
      ),
    });
  };
  const onPointerUp = () => {
    const held = press.current;
    const bounds = area();
    press.current = undefined;
    if (held?.moved !== true) return;
    dragged.current = true;
    if (windowed) {
      setOnScreen(screenPlacement());
      return;
    }
    if (dragging !== undefined && bounds !== undefined) setDock(snapDock(dragging, bounds));
    setDragging(undefined);
  };
  const onClick = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    drop.dismiss();
    setOpen(!open);
  };

  const hint = tool?.label ?? (state === "error" ? "Something failed" : "Gram · nothing running");
  return (
    <div
      ref={anchor}
      data-testid="companion-anchor"
      data-edge={windowed ? undefined : dock.edge}
      data-windowed={windowed || undefined}
      data-dragging={dragging !== undefined || undefined}
      className="companion-anchor absolute"
      style={{
        ...skinStyle(PEBBLE, faceOf(PEBBLE, state, asks)),
        ...(windowed
          ? cornerStyle(placement)
          : dragging === undefined
            ? dockStyle(dock)
            : { left: dragging.x, top: dragging.y }),
      }}
    >
      {windowed && <span aria-hidden className="companion-grip" />}
      <Avatar
        state={state}
        asks={asks}
        open={open}
        lifted={dragging !== undefined}
        label={tool?.label}
        onClick={onClick}
        onHover={setHovered}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {hovered && !open && dragging === undefined && (
        <span
          role="tooltip"
          data-testid="companion-hint"
          className={cn(
            "companion-glass companion-hint pointer-events-none absolute top-1/2 w-max max-w-[min(20rem,calc(100vw-5rem))] -translate-y-1/2 truncate rounded-full px-3 py-1 text-meta whitespace-nowrap",
            placement.horizontal === "end" ? "right-full mr-2" : "left-full ml-2",
          )}
        >
          {hint}
        </span>
      )}
      {dragging === undefined && (open || drop.shown !== undefined) && (
        <div
          className={besideStyle(placement)}
          data-placement={`${placement.vertical}-${placement.horizontal}`}
        >
          {open
            ? panel
            : drop.shown !== undefined && (
                <button
                  type="button"
                  key={drop.shown.key}
                  data-testid="companion-drop"
                  data-tone={drop.shown.tone}
                  onClick={() => {
                    drop.dismiss();
                    setOpen(true);
                  }}
                  className={cn(
                    "companion-glass companion-drop max-w-64 px-3 py-2 text-left text-body leading-snug text-foreground",
                    placement.vertical === "below" ? "origin-top" : "origin-bottom",
                  )}
                >
                  {drop.shown.tone === "needs" && (
                    <span className="mb-0.5 block text-meta font-semibold text-status-needs">
                      Needs you
                    </span>
                  )}
                  {drop.shown.text}
                </button>
              )}
        </div>
      )}
    </div>
  );
}

function useDrop(
  open: boolean,
  loaded: boolean,
  reply: string | undefined,
  needs: readonly NeedsYouItem[],
) {
  const keys = needs.map((item) => item.key).join("\n");
  const [seen, setSeen] = useState({ reply, keys, loaded });
  const [drop, flash] = useFlash<Drop>(DROP_MS);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  if (seen.reply !== reply || seen.keys !== keys || seen.loaded !== loaded) {
    const known = new Set(seen.keys.split("\n"));
    const fresh = needs.find((item) => !known.has(item.key));
    setSeen({ reply, keys, loaded });
    const speaks = seen.loaded && !open;
    if (speaks && fresh !== undefined)
      flash({ key: fresh.key, tone: "needs", text: excerpt(fresh.title, 90) });
    else if (speaks && reply !== undefined && reply !== seen.reply)
      flash({ key: `reply:${reply.slice(0, 24)}`, tone: "reply", text: excerpt(reply, 160) });
  }
  const shown = open || drop === undefined || drop.key === dismissed ? undefined : drop;
  return { shown, dismiss: () => setDismissed(drop?.key) };
}

function Avatar({
  state,
  asks,
  open,
  lifted,
  label,
  onClick,
  onHover,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  state: AvatarState;
  asks: boolean;
  open: boolean;
  lifted: boolean;
  label: string | undefined;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
}) {
  const keys = useShortcutHint("view.companion");
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            data-testid="companion-avatar"
            data-state={state}
            data-asks={asks || undefined}
            data-lifted={lifted || undefined}
            data-face-motion={faceOf(PEBBLE, state, asks).motion}
            aria-expanded={open}
            aria-label={`${label ?? STATE_WORDS[state]}${asks ? ", something needs you" : ""}. ${open ? "Close" : "Open"} the companion`}
            onClick={onClick}
            onPointerEnter={() => onHover(true)}
            onPointerLeave={() => onHover(false)}
            onFocus={() => onHover(true)}
            onBlur={() => onHover(false)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="companion-pebble relative grid shrink-0 cursor-grab touch-none place-items-center rounded-full outline-none select-none focus-visible:focus-ring"
          />
        }
      >
        <span aria-hidden className="companion-mark" />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => leaveCompanion()}>
          <LayoutPanelLeft />
          Open full Gram
          {keys !== undefined && (
            <span className="ml-auto text-meta text-muted-foreground">{keys}</span>
          )}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
