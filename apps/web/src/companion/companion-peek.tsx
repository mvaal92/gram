import type { PlanItem, ThreadId, ThreadSummary } from "@gram/contracts";
import { useState } from "react";

import { useDebounced } from "@/lib/timers";
import { cn } from "@/lib/utils";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { StatusDot } from "@/orchestration/status-dot";
import { useThreadFeed } from "@/stores/feeds";
import { useThreadsStore } from "@/stores/threads";

import { useCompanion } from "./companion-store";
import { X } from "lucide-react";

import {
  activeTool,
  endingKey,
  hostLabel,
  topLineOf,
  type ActiveTool,
  type CompanionPlan,
  type CompanionTask,
} from "./companion-model";

const PEEK_OPEN_MS = 220;
const PEEK_CLOSE_MS = 160;

const fitBubble = (peek: HTMLDivElement | null) => {
  const bubble = peek?.closest<HTMLElement>("[data-testid=companion-bubble]");
  const placement = peek?.closest<HTMLElement>("[data-placement]")?.dataset["placement"];
  if (peek === null || bubble === null || bubble === undefined) return undefined;
  if (placement?.startsWith("below") !== true) return undefined;
  const fit = () => {
    bubble.style.minHeight = `${Math.ceil(peek.offsetTop + peek.scrollHeight + 12)}px`;
  };
  const observer = new ResizeObserver(fit);
  for (const child of peek.children) observer.observe(child);
  fit();
  return () => {
    observer.disconnect();
    bubble.style.minHeight = "";
  };
};

const TOP_DOT = { needs: "needs", working: "working", stuck: "error", quiet: "idle" } as const;

export function Peek(props: Omit<PeekProps, "own" | "todos"> & { threadId: ThreadId | undefined }) {
  const { threadId, ...rest } = props;
  return threadId === undefined ? (
    <PeekView {...rest} own={undefined} todos={undefined} />
  ) : (
    <ThreadPeek threadId={threadId} {...rest} />
  );
}

function ThreadPeek({
  threadId,
  ...rest
}: Omit<PeekProps, "own" | "todos"> & { threadId: ThreadId }) {
  const messages = useThreadFeed(threadId, (s) => s.messages);
  const todos = useThreadsStore((s) => s.plans[threadId]);
  return <PeekView {...rest} own={activeTool(messages)} todos={todos} />;
}

interface PeekProps {
  needs: readonly NeedsYouItem[];
  hosts: readonly ThreadSummary[];
  tasks: readonly CompanionTask[];
  plan: CompanionPlan | undefined;
  todos: readonly PlanItem[] | undefined;
  busy: ActiveTool | undefined;
  own: ActiveTool | undefined;
  onOpen: (threadId?: ThreadId) => void;
}

function PeekView({ needs, hosts, tasks, plan, todos, busy, own, onOpen }: PeekProps) {
  const line = topLineOf({ needs: [], step: own ?? busy, plan, tasks });
  const [pinned, setPinned] = useState(false);
  const [inside, setInside] = useState(false);
  const [eager, setEager] = useState(false);
  const settled = useDebounced(inside, inside ? PEEK_OPEN_MS : PEEK_CLOSE_MS);
  const open = settled || (eager && inside);
  const enter = () => setInside(true);
  const leave = () => {
    setInside(false);
    setEager(false);
  };
  const shown = open || pinned;
  const hasMore =
    hosts.length > 0 || tasks.length > 0 || plan !== undefined || (todos?.length ?? 0) > 0;
  return (
    <div
      className="contents"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") enter();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") leave();
      }}
    >
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center gap-1.5",
          line === undefined && needs.length === 0 && !hasMore && "hidden",
        )}
      >
        <button
          type="button"
          data-testid="companion-topline"
          data-tone={line?.tone}
          data-rest={line?.tone === "stuck" || undefined}
          aria-expanded={shown}
          aria-label={line === undefined ? "Nothing running" : line.text}
          disabled={line === undefined && !hasMore}
          onWheel={() => {
            setInside(true);
            setEager(true);
          }}
          onClick={() => {
            if (open && !pinned) return;
            setPinned(!pinned);
          }}
          className="companion-topline flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-meta text-muted-foreground outline-none focus-visible:focus-ring"
        >
          {line !== undefined && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <StatusDot state={TOP_DOT[line.tone]} still={line.tone !== "working"} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  line.tone === "needs" && "text-status-needs",
                )}
              >
                {line.text}
              </span>
            </span>
          )}
        </button>
        {needs.length > 0 && (
          <button
            type="button"
            data-testid="companion-asks"
            onClick={() => useCompanion.getState().showSheet({ kind: "decide" })}
            className="companion-asks flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-meta text-status-needs outline-none hover:bg-surface-2 focus-visible:focus-ring"
          >
            <StatusDot state="needs" still />
            {needs.length === 1 ? "1 asks you" : `${needs.length} ask you`}
          </button>
        )}
      </div>
      {shown && hasMore && (
        <div
          ref={fitBubble}
          data-testid="companion-peek"
          className="companion-peek absolute inset-x-2 top-7.5 z-10 flex max-h-[calc(100%-2.5rem)] flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl p-2.5"
        >
          <PlanList plan={plan} todos={todos} />
          <Tasks tasks={tasks} onOpen={onOpen} />
          {hosts.map((summary) => (
            <HostCard key={summary.thread.id} summary={summary} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

const PLAN_MARK = { completed: "✓", inProgress: "•", pending: "○", cancelled: "–" } as const;
const STEP_MARK = { done: "✓", doing: "•", todo: "○" } as const;

function Tasks({
  tasks,
  onOpen,
}: {
  tasks: readonly CompanionTask[];
  onOpen: (threadId?: ThreadId) => void;
}) {
  if (tasks.length === 0) return null;
  const shown = tasks;
  return (
    <section data-testid="companion-tasks" aria-label="Tasks" className="flex flex-col gap-0.5">
      <h2 className="flex justify-between text-meta text-subtle">
        <span>Tasks</span>
      </h2>
      {shown.map((task) => (
        <div key={task.id} className="group/task flex min-w-0 items-center gap-1">
          <button
            type="button"
            data-testid="companion-task"
            data-phase={task.phase}
            title={task.line === undefined ? task.title : `${task.title}\n${task.line}`}
            onClick={() => onOpen(task.id)}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-left text-meta hover:bg-surface-2"
          >
            <StatusDot state={TASK_DOT[task.phase]} still={task.phase !== "doing"} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                task.phase === "done" && "text-muted-foreground",
              )}
            >
              {task.title}
            </span>
            <span
              className={cn(
                "max-w-28 shrink-0 truncate",
                task.phase === "needs"
                  ? "text-status-needs"
                  : task.phase === "failed"
                    ? "text-destructive"
                    : "text-subtle",
              )}
            >
              {TASK_EDGE[task.phase](task)}
            </span>
          </button>
          {task.phase === "failed" && (
            <button
              type="button"
              data-testid="companion-task-dismiss"
              aria-label={`Dismiss ${task.title}`}
              title="Dismiss"
              onClick={() => useCompanion.getState().dismiss(endingKey(task))}
              className="grid size-5 shrink-0 place-items-center rounded-2xs text-subtle opacity-60 outline-none group-hover/task:opacity-100 hover:bg-surface-2 hover:text-foreground focus-visible:focus-ring"
            >
              <X aria-hidden className="size-3" />
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

const TASK_DOT = { doing: "working", needs: "needs", done: "done", failed: "error" } as const;

const TASK_EDGE: Record<CompanionTask["phase"], (task: CompanionTask) => string> = {
  doing: (task) => task.progress ?? "running",
  needs: () => "asks you",
  done: () => "done",
  failed: (task) => (task.blocked === true ? "blocked" : "failed"),
};

function PlanList({
  plan,
  todos,
}: {
  plan: CompanionPlan | undefined;
  todos: readonly PlanItem[] | undefined;
}) {
  if (plan !== undefined) {
    return (
      <section
        data-testid="companion-plan"
        aria-label="Plan"
        className="flex flex-col gap-0.5 text-meta"
      >
        <h2 className="flex min-w-0 justify-between gap-2 text-subtle">
          <span className="truncate">{plan.title}</span>
          {plan.total > 0 ? (
            <span className="shrink-0 font-mono">
              {plan.done} of {plan.total}
            </span>
          ) : (
            plan.current !== undefined && <span className="truncate">{plan.current}</span>
          )}
        </h2>
        <ol className="flex flex-col gap-0.5">
          {plan.steps.map((step, index) => (
            <li
              key={index}
              className={cn(
                "flex min-w-0 gap-1.5",
                step.status === "done" ? "text-subtle" : "text-muted-foreground",
                step.status === "doing" && "text-foreground",
              )}
            >
              <span aria-hidden>{STEP_MARK[step.status]}</span>
              <span className="truncate">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (todos === undefined || todos.length === 0) return null;
  return (
    <ol data-testid="companion-plan" className="flex flex-col gap-0.5 text-meta">
      {todos.map((item, index) => (
        <li
          key={index}
          className={cn(
            "flex min-w-0 gap-1.5",
            item.status === "completed" || item.status === "cancelled"
              ? "text-subtle"
              : "text-muted-foreground",
          )}
        >
          <span aria-hidden>{PLAN_MARK[item.status]}</span>
          <span className="truncate">
            {item.status === "inProgress" ? (item.activeForm ?? item.content) : item.content}
          </span>
        </li>
      ))}
    </ol>
  );
}

function HostCard({
  summary,
  onOpen,
}: {
  summary: ThreadSummary;
  onOpen: (threadId?: ThreadId) => void;
}) {
  const live = summary.status === "running" || summary.status === "starting";
  return (
    <button
      type="button"
      data-testid="companion-host"
      onClick={() => onOpen(summary.thread.id)}
      className="companion-inset flex flex-col gap-1 rounded-xl px-2.5 py-2 text-left text-meta hover:bg-surface-2"
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot state={live ? "working" : summary.status === "error" ? "error" : "idle"} />
          <strong className="truncate font-semibold">{summary.thread.title}</strong>
        </span>
        <span className="shrink-0 text-subtle">{hostLabel(summary)}</span>
      </span>
    </button>
  );
}
