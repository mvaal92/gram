import type { ThreadId } from "@gram/contracts";
import {
  FileText,
  Globe,
  LayoutPanelLeft,
  Network,
  Search,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useShortcutHint } from "@/keyboard/use-shortcut-hint";
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
  type ToolKind,
} from "./companion-model";
import { useCompanion } from "./companion-store";

const TOOL_GLYPH: Record<ToolKind, LucideIcon> = {
  terminal: SquareTerminal,
  search: Search,
  file: FileText,
  worker: Network,
  web: Globe,
  other: Wrench,
};

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
 * The avatar with what it says on its own: the tool under way while it works, and a speech drop
 * when a reply lands or something new asks the person while the bubble is closed.
 */
export function CompanionPresence({
  threadId,
  state,
  asks,
  busy,
  needs,
}: {
  threadId: ThreadId | undefined;
  state: AvatarState;
  /** Something waits on the person: the amber dot and the hop. */
  asks: boolean;
  /** A running worker's line, shown when the companion's own turn names no tool. */
  busy: ActiveTool | undefined;
  needs: readonly NeedsYouItem[];
}) {
  return threadId === undefined ? (
    <Presence state={state} asks={asks} needs={needs} tool={busy} reply={undefined} loaded />
  ) : (
    <ThreadPresence threadId={threadId} state={state} asks={asks} busy={busy} needs={needs} />
  );
}

function ThreadPresence({
  threadId,
  state,
  asks,
  busy,
  needs,
}: {
  threadId: ThreadId;
  state: AvatarState;
  asks: boolean;
  busy: ActiveTool | undefined;
  needs: readonly NeedsYouItem[];
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
    />
  );
}

function Presence({
  state,
  asks,
  needs,
  tool,
  reply,
  loaded,
}: {
  state: AvatarState;
  asks: boolean;
  needs: readonly NeedsYouItem[];
  tool: ActiveTool | undefined;
  reply: string | undefined;
  loaded: boolean;
}) {
  const open = useCompanion((s) => s.open);
  const setOpen = useCompanion((s) => s.setOpen);
  const drop = useDrop(open, loaded, reply, needs);
  return (
    <>
      {!open && drop.shown !== undefined && (
        <button
          type="button"
          key={drop.shown.key}
          data-testid="companion-drop"
          data-tone={drop.shown.tone}
          onClick={() => {
            drop.dismiss();
            setOpen(true);
          }}
          className="companion-drop relative max-w-64 rounded-xl border border-border bg-surface-3 px-3 py-2 text-left text-body leading-snug text-foreground shadow-overlay"
        >
          {drop.shown.tone === "needs" && (
            <span className="mb-0.5 block text-meta font-semibold text-status-needs">
              Needs you
            </span>
          )}
          {drop.shown.text}
        </button>
      )}
      {!open && tool !== undefined && (
        <span
          data-testid="companion-working"
          aria-live="polite"
          className="flex max-w-60 items-center gap-1.5 rounded-full border border-border bg-surface-3 px-2.5 py-1 text-meta text-muted-foreground shadow-raised"
        >
          <span className="truncate">{tool.label}</span>
          <span aria-hidden className="companion-dots flex gap-0.5">
            <i />
            <i />
            <i />
          </span>
        </span>
      )}
      <Avatar
        state={state}
        asks={asks}
        open={open}
        tool={tool}
        talking={!open && drop.shown !== undefined}
        onClick={() => {
          drop.dismiss();
          setOpen(!open);
        }}
      />
    </>
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
  tool,
  talking,
  onClick,
}: {
  state: AvatarState;
  asks: boolean;
  open: boolean;
  tool: ActiveTool | undefined;
  talking: boolean;
  onClick: () => void;
}) {
  const leave = useCompanion((s) => s.set);
  const keys = useShortcutHint("view.companion");
  const Glyph = tool === undefined ? undefined : TOOL_GLYPH[tool.kind];
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            data-testid="companion-avatar"
            data-state={state}
            data-asks={asks || undefined}
            data-talking={talking || undefined}
            aria-expanded={open}
            aria-label={`${STATE_WORDS[state]}${asks ? ", something needs you" : ""}. ${open ? "Close" : "Open"} the companion`}
            title={tool?.label ?? STATE_WORDS[state]}
            onClick={onClick}
            className={cn(
              "companion-orb relative grid shrink-0 cursor-pointer place-items-center rounded-full border border-border-strong bg-surface-3 shadow-raised outline-none focus-visible:focus-ring",
              open ? "size-11" : "size-14",
            )}
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "companion-face relative flex flex-col items-center justify-center rounded-full",
            state === "error" ? "bg-destructive" : "bg-primary",
            open ? "size-8" : "size-10",
          )}
        >
          <span className="companion-eyes flex">
            <span className="companion-eye" />
            <span className="companion-eye" />
          </span>
          <span className="companion-mouth" />
        </span>
        {Glyph !== undefined && (
          <span
            aria-hidden
            data-testid="companion-tool-badge"
            className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full border border-border-strong bg-surface-3 text-foreground"
          >
            <Glyph className="size-3" />
          </span>
        )}
        {asks && (
          <span
            aria-hidden
            className="absolute top-0 right-0 size-3 rounded-full border-2 border-surface-3 bg-status-needs-mark"
          />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => leave(false)}>
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
