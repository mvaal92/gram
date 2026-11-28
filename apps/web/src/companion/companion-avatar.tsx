import type { ThreadId } from "@gram/contracts";
import {
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { useAttachments } from "@/composer/use-attachments";
import { useExternalSync, useLatest, useSubscription } from "@/lib/effects";
import { useFlash } from "@/lib/timers";
import { cn } from "@/lib/utils";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useThreadFeed } from "@/stores/feeds";

import {
  activeTool,
  endingsOf,
  lastExchange,
  tasksLine,
  openTasks,
  noticeDrops,
  type ActiveTool,
  type CompanionTask,
  type Drop,
  type DropSeen,
  type AvatarState,
  type SeenReply,
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
import { Customize } from "./companion-customize";
import { faceOf, PEBBLE, skinStyle } from "./companion-skin";
import { cornerStyle, findPlacement, placementAt, useWindowFit } from "./companion-window-fit";
import { useCompanion } from "./companion-store";
import { desktopCompanion, leaveCompanion } from "./desktop-companion";

const STATE_WORDS: Record<AvatarState, string> = {
  idle: "Gram",
  working: "Gram is working",
  error: "Gram: something failed",
};

const DROP_MS = 9000;

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
  tasks,
  settled,
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
  /** The work it follows, whose endings drop out and ping; `undefined` until it has loaded. */
  tasks: readonly CompanionTask[] | undefined;
  /** Its own thread's turn is over, so its latest reply is final. */
  settled: boolean;
  panel: ReactNode;
  /** In the desktop app's companion window: dragging moves the window, which fits its content. */
  windowed?: boolean;
}) {
  return threadId === undefined ? (
    <Presence
      state={state}
      asks={asks}
      needs={needs}
      tasks={tasks}
      tool={busy}
      reply={undefined}
      settled
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
      tasks={tasks}
      settled={settled}
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
  tasks,
  settled,
  panel,
  windowed,
}: {
  threadId: ThreadId;
  state: AvatarState;
  asks: boolean;
  busy: ActiveTool | undefined;
  needs: readonly NeedsYouItem[];
  tasks: readonly CompanionTask[] | undefined;
  settled: boolean;
  panel: ReactNode;
  windowed: boolean;
}) {
  const messages = useThreadFeed(threadId, (s) => s.messages);
  const own = activeTool(messages);
  const tool = own ?? busy;
  const { reply, replyId } = lastExchange(messages);
  const loaded = useThreadFeed(threadId, (s) => s.phase === "live");
  const attachments = useAttachments({ threadId });
  return (
    <Presence
      onFiles={(files) => attachments.add(files)}
      state={tool !== undefined && state === "idle" ? "working" : state}
      asks={asks}
      needs={needs}
      tasks={tasks}
      tool={tool}
      reply={
        reply === undefined || replyId === undefined ? undefined : { id: replyId, text: reply }
      }
      settled={settled && own === undefined}
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
  tasks,
  tool,
  reply,
  settled,
  loaded,
  panel,
  windowed,
  onFiles,
}: {
  onFiles?: (files: FileList) => boolean;
  state: AvatarState;
  asks: boolean;
  needs: readonly NeedsYouItem[];
  tasks: readonly CompanionTask[] | undefined;
  tool: ActiveTool | undefined;
  reply: SeenReply | undefined;
  settled: boolean;
  loaded: boolean;
  panel: ReactNode;
  windowed: boolean;
}) {
  const open = useCompanion((s) => s.open);
  const customizing = useCompanion((s) => s.customizing);
  const setOpen = useCompanion((s) => s.setOpen);
  const dock = useCompanion((s) => s.dock);
  const setDock = useCompanion((s) => s.setDock);
  const drop = useDrop({ open, loaded, reply, settled, needs, tasks });
  const [hovered, setHovered] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const dismissed = useCompanion((s) => s.dismissed);
  const shownTasks = openTasks(tasks ?? [], dismissed);
  const stuck = shownTasks.filter((task) => task.phase === "failed").length;
  const anchor = useRef<HTMLDivElement>(null);
  const press = useRef<{ start: Point; offset: Point; moved: boolean } | undefined>(undefined);
  const [dragging, setDragging] = useState<Point | undefined>(undefined);
  const dragged = useRef(false);
  const [onScreen, setOnScreen] = useState<Placement>(() => placementAt("top-right"));
  const [placed, setPlaced] = useState(false);
  const place = (found: Placement) => {
    setOnScreen(found);
    setPlaced(true);
  };
  const placement = windowed ? onScreen : placementOf(dock);
  const moving = useRef(false);
  const resting = !open && !customizing && drop.shown === undefined && (windowed || !hovered);
  if (resting && placed) setPlaced(false);
  const findPlace = () => findPlacement(windowed, setOnScreen);
  useExternalSync(() => {
    if (!resting) findPlacement(windowed, place);
  }, [resting, windowed]);
  useWindowFit(windowed, anchor, placement, resting, open && !settled, resting || placed);

  const area = () => anchor.current?.parentElement?.getBoundingClientRect();
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
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
    if ((event.buttons & 1) === 0) {
      endPress();
      return;
    }
    const dx = event.clientX - held.start.x;
    const dy = event.clientY - held.start.y;
    if (!held.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    const starting = !held.moved;
    held.moved = true;
    if (windowed) {
      const bridge = desktopCompanion();
      if (bridge?.dragStart !== undefined) {
        if (starting) bridge.dragStart({ x: held.start.x, y: held.start.y });
        return;
      }
      if (bridge === undefined || moving.current) return;
      moving.current = true;
      void bridge
        .moveBy({ dx, dy })
        .catch((error: unknown) => console.error("companion: move", error))
        .finally(() => {
          moving.current = false;
        });
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
  const tapped = useRef(false);
  const endPress = () => {
    const held = press.current;
    const bounds = area();
    press.current = undefined;
    if (held?.moved !== true) return;
    dragged.current = true;
    if (windowed) {
      desktopCompanion()?.dragEnd?.();
      findPlace();
      return;
    }
    if (dragging !== undefined && bounds !== undefined) setDock(snapDock(dragging, bounds));
    setDragging(undefined);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const held = press.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (held !== undefined && !held.moved && event.type === "pointerup") {
      press.current = undefined;
      tapped.current = true;
      drop.dismiss();
      setOpen(!open);
      return;
    }
    endPress();
  };
  const ending = useLatest(endPress);
  useSubscription(() => {
    const end = () => ending.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") end();
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", end);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", end);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [ending]);
  const onClick = () => {
    if (tapped.current || dragged.current) {
      tapped.current = false;
      dragged.current = false;
      return;
    }
    drop.dismiss();
    setOpen(!open);
  };

  const hint = fileOver
    ? "Drop to attach"
    : (tool?.label ??
      (state === "error"
        ? "Something failed"
        : (tasksLine(shownTasks) ?? "Gram · nothing running")));
  const files = {
    onDragEnter: (event: DragEvent<HTMLButtonElement>) => {
      if (onFiles === undefined || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setFileOver(true);
    },
    onDragOver: (event: DragEvent<HTMLButtonElement>) => {
      if (onFiles === undefined || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => setFileOver(false),
    onDrop: (event: DragEvent<HTMLButtonElement>) => {
      if (onFiles === undefined || !event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      setFileOver(false);
      if (onFiles(event.dataTransfer.files)) {
        drop.dismiss();
        setOpen(true);
      }
    },
  };
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
      {(needs.length > 0 || stuck > 0) && (
        <span
          aria-hidden
          data-testid="companion-count"
          data-tone={needs.length > 0 ? "needs" : "stuck"}
          className={cn(
            "companion-count pointer-events-none absolute -top-1 -right-1 z-10 grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 font-mono text-meta leading-none font-semibold",
            needs.length > 0 ? "text-status-needs" : "text-muted-foreground",
          )}
        >
          {Math.min(needs.length > 0 ? needs.length : stuck, 9)}
          {(needs.length > 0 ? needs.length : stuck) > 9 ? "+" : ""}
        </span>
      )}
      <Avatar
        state={state}
        asks={asks}
        open={open}
        lifted={dragging !== undefined}
        label={tool?.label}
        nativeTooltip={windowed ? hint : undefined}
        onClick={onClick}
        onHover={setHovered}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onLostCapture={endPress}
        fileOver={fileOver}
        files={files}
      />
      {hovered && !open && !customizing && dragging === undefined && !windowed && (
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
      {dragging === undefined && (open || customizing || drop.shown !== undefined) && (
        <div
          className={besideStyle(placement)}
          data-placement={`${placement.vertical}-${placement.horizontal}`}
        >
          {open ? (
            panel
          ) : customizing ? (
            <Customize windowed={windowed} />
          ) : (
            drop.shown !== undefined && (
              <button
                type="button"
                key={drop.shown.key}
                data-testid="companion-drop"
                data-tone={drop.shown.tone}
                onClick={() => {
                  const shown = drop.shown;
                  drop.dismiss();
                  if (shown?.tone === "needs")
                    useCompanion.getState().showSheet({ kind: "decide", start: shown.key });
                  else setOpen(true);
                }}
                className={cn(
                  "companion-glass companion-drop max-w-64 px-3 py-2 text-left text-body leading-snug text-foreground",
                  placement.vertical === "below" ? "origin-top" : "origin-bottom",
                )}
              >
                <DropHeading drop={drop.shown} />
                {drop.shown.text}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function useDrop({
  open,
  loaded,
  reply,
  settled,
  needs,
  tasks,
}: {
  open: boolean;
  loaded: boolean;
  reply: SeenReply | undefined;
  settled: boolean;
  needs: readonly NeedsYouItem[];
  tasks: readonly CompanionTask[] | undefined;
}) {
  const endings = endingsOf(tasks ?? []);
  const tasksLoaded = tasks !== undefined;
  const signature = [
    open,
    loaded,
    tasksLoaded,
    settled,
    reply?.id ?? "",
    ...needs.map((item) => item.key),
    "|",
    ...endings.map((task) => `${task.id}:${task.phase}`),
  ].join("\n");
  const [seen, setSeen] = useState<{ signature: string; drops: DropSeen }>(() => ({
    signature: "",
    drops: {
      replies: [],
      keys: needs.map((item) => item.key),
      endings: [],
      loaded: false,
      tasksLoaded: false,
    },
  }));
  const [ask, setAsk] = useState<Drop | undefined>(undefined);
  const [replied, flash] = useFlash<Drop>(DROP_MS);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  if (seen.signature !== signature) {
    const noticed = noticeDrops(seen.drops, {
      reply,
      settled,
      needs,
      endings,
      tasksLoaded,
      loaded,
      open,
    });
    setSeen({ signature, drops: noticed.seen });
    if (noticed.ask !== undefined) setAsk(noticed.ask);
    const said = noticed.reply ?? noticed.ended;
    if (said !== undefined) flash(said);
    if (noticed.ended !== undefined) pingEnding(noticed.ended);
  }
  const askStands =
    ask !== undefined && !dismissed.has(ask.key) && needs.some((item) => item.key === ask.key);
  const shown = open
    ? undefined
    : askStands
      ? ask
      : replied !== undefined && !dismissed.has(replied.key)
        ? replied
        : undefined;
  return {
    shown,
    dismiss: () => {
      if (shown !== undefined) setDismissed((before) => new Set(before).add(shown.key));
    },
  };
}

const HEADING: Record<
  Drop["tone"],
  { readonly words: string; readonly className: string } | undefined
> = {
  needs: { words: "Needs you", className: "text-status-needs" },
  done: { words: "Done", className: "text-muted-foreground" },
  failed: { words: "Failed", className: "text-destructive" },
  reply: undefined,
};

function DropHeading({ drop }: { drop: Drop }) {
  const heading = HEADING[drop.tone];
  if (heading === undefined) return null;
  return (
    <span className={cn("mb-0.5 block truncate text-meta font-semibold", heading.className)}>
      {drop.title === undefined
        ? (drop.word ?? heading.words)
        : `${drop.word ?? heading.words} · ${drop.title}`}
    </span>
  );
}

function pingEnding(drop: Drop): void {
  if (!useCompanion.getState().pings) return;
  const bridge = typeof window === "undefined" ? undefined : window.gram;
  if (bridge === undefined || !(bridge.companion?.isWindow ?? false)) return;
  bridge.notify({
    id: `companion:${drop.key}`,
    title: `${drop.word ?? (drop.tone === "failed" ? "Failed" : "Done")}: ${drop.title ?? "task"}`,
    body: drop.text,
  });
}

function Avatar({
  state,
  asks,
  open,
  lifted,
  label,
  nativeTooltip,
  onClick,
  onHover,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLostCapture,
  fileOver,
  files,
}: {
  fileOver: boolean;
  files: {
    onDragEnter: (event: DragEvent<HTMLButtonElement>) => void;
    onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  };
  state: AvatarState;
  asks: boolean;
  open: boolean;
  lifted: boolean;
  label: string | undefined;
  nativeTooltip: string | undefined;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onLostCapture: () => void;
}) {
  const customizing = useCompanion((s) => s.customizing);
  const customize = useCompanion((s) => s.setCustomizing);
  return (
    <button
      type="button"
      data-testid="companion-avatar"
      data-state={state}
      data-asks={asks || undefined}
      data-lifted={lifted || undefined}
      data-file-over={fileOver || undefined}
      data-face-motion={faceOf(PEBBLE, state, asks).motion}
      data-mark={faceOf(PEBBLE, state, asks).mark.shape}
      aria-expanded={open}
      title={nativeTooltip}
      aria-label={`${label ?? STATE_WORDS[state]}${asks ? ", something needs you" : ""}. ${open ? "Close" : "Open"} the companion`}
      onClick={onClick}
      onDoubleClick={() => leaveCompanion()}
      onContextMenu={(event) => {
        event.preventDefault();
        customize(!customizing);
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onLostCapture}
      {...files}
      className="companion-pebble relative grid shrink-0 cursor-grab touch-none place-items-center rounded-full outline-none select-none focus-visible:focus-ring"
    >
      <span aria-hidden className="companion-mark" />
    </button>
  );
}
