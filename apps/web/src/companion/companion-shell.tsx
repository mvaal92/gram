import type { PlanItem, ThreadId, ThreadSummary, WorkspaceState } from "@gram/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";

import { useApi } from "@/api/context";
import { useLayoutSync, useMountEffect, useSubscription } from "@/lib/effects";
import { Markdown } from "@/components/ai-elements/markdown";
import { cn } from "@/lib/utils";
import { MockCard } from "@/thread/mock-visuals";
import { Button } from "@/components/ui/button";
import { answersInFull } from "@/inbox/inbox-detail";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useNeedsYouActions } from "@/orchestration/needs-you-row";
import { StatusDot } from "@/orchestration/status-dot";
import { useNeedsYouList } from "@/orchestration/use-needs-you";
import { useOrchestratorLedger, useWorkspaces } from "@/orchestration/use-orchestration";
import { useThreadFeed } from "@/stores/feeds";
import { useThreadsStore } from "@/stores/threads";
import { useViewWorkspace } from "@/views/view-workspace";

import { CompanionPresence } from "./companion-avatar";
import {
  activeTool,
  avatarState,
  hostLabel,
  hostThreads,
  historyOf,
  textOf,
  latestThread,
  needsPerson,
  ownLine,
  planHint,
  plansOf,
  shownPlan,
  tasksLine,
  tasksOf,
  threadPlanOf,
  workersLine,
  type ActiveTool,
  type CompanionPlan,
  type CompanionTask,
} from "./companion-model";
import { followStoredCompanion, useCompanion } from "./companion-store";
import { isCompanionWindow, leaveCompanion } from "./desktop-companion";

function useCompanionWorkspace(): WorkspaceState | undefined {
  const viewed = useViewWorkspace();
  const workspaces = useWorkspaces();
  const linkedId = useCompanion((s) => s.workspaceId);
  const linked = workspaces.find((w) => w.workspace.id === linkedId);
  if (linked !== undefined) return linked;
  if (viewed?.workspace.orchestratorThreadId !== undefined) return viewed;
  return workspaces.find((w) => w.workspace.orchestratorThreadId !== undefined) ?? viewed;
}

/**
 * Companion mode: the whole window is a round avatar in its corner, and a small bubble with one
 * input and the latest reply. It talks to the workspace's orchestrator, which runs its workers as
 * ever; asks, approvals and threads an embedding host started show as compact cards.
 */
export function CompanionShell({ windowed = false }: { windowed?: boolean }) {
  const workspace = useCompanionWorkspace();
  const all = useThreadsStore((s) => s.byId);
  const params: { threadId?: ThreadId } = useParams({ strict: false });
  const routeThread = params.threadId;
  const summaries = useMemo(() => Object.values(all), [all]);
  const threadId =
    workspace?.workspace.orchestratorThreadId ??
    (workspace === undefined
      ? routeThread !== undefined && all[routeThread] !== undefined
        ? routeThread
        : latestThread(summaries)
      : undefined);
  const needs = useNeedsYouList().items;
  const target = threadId === undefined ? undefined : all[threadId];
  const watched = useMemo(
    () =>
      summaries.filter(
        (s) =>
          s.thread.id === threadId ||
          (workspace !== undefined && s.thread.workspaceId === workspace.workspace.id) ||
          (s.thread.conversations?.length ?? 0) > 0,
      ),
    [summaries, threadId, workspace],
  );
  const state = avatarState(target, watched);
  const asks = needsPerson(watched, needs.length);
  const asksHere = needs.some((item) => item.threadId !== undefined && item.threadId === threadId);
  const ledger = useOrchestratorLedger(workspace?.workspace.id).data;
  const tasks = useMemo(() => tasksOf(ledger), [ledger]);
  const ledgerIn = workspace === undefined || ledger !== undefined;
  const plans = useMemo(() => plansOf(ledger), [ledger]);
  const plan = workspace === undefined ? threadPlanOf(target?.plan) : shownPlan(plans, tasks);
  const where = planHint(plan);
  const workers = workersLine(
    workspace === undefined
      ? watched
      : watched.filter((s) => s.thread.workspaceId === workspace.workspace.id),
    threadId,
  );
  const busy =
    (asksHere ? ownLine(target, true) : undefined) ??
    (workers === undefined
      ? undefined
      : {
          ...workers,
          label:
            where === undefined
              ? workers.label
              : `${where} · ${workers.label.replace(/ · working$/u, "")}`,
        }) ??
    ownLine(target) ??
    (where === undefined ? undefined : { kind: "other" as const, label: where });
  const settled =
    target === undefined || (target.status !== "running" && target.status !== "starting");

  useSubscription(() => followStoredCompanion(), []);

  useLayoutSync(() => {
    if (!windowed) return undefined;
    document.documentElement.dataset["companionWindow"] = "";
    return () => {
      delete document.documentElement.dataset["companionWindow"];
    };
  }, [windowed]);

  return (
    <div
      data-testid="companion"
      data-windowed={windowed || undefined}
      className="relative h-dvh w-full overflow-hidden text-foreground"
    >
      <CompanionPresence
        threadId={threadId}
        state={state}
        asks={asks}
        busy={busy}
        needs={needs}
        tasks={ledgerIn ? tasks : undefined}
        settled={settled}
        windowed={windowed}
        panel={
          <Bubble
            workspace={workspace}
            target={target}
            needs={needs}
            hosts={hostThreads(summaries)}
            tasks={tasks}
            plan={plan}
            busy={busy}
          />
        }
      />
    </div>
  );
}

function Bubble({
  workspace,
  target,
  needs,
  hosts,
  tasks,
  plan,
  busy,
}: {
  workspace: WorkspaceState | undefined;
  target: ThreadSummary | undefined;
  needs: readonly NeedsYouItem[];
  hosts: readonly ThreadSummary[];
  tasks: readonly CompanionTask[];
  plan: CompanionPlan | undefined;
  busy: ActiveTool | undefined;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const openFull = (threadId?: ThreadId) => {
    if (isCompanionWindow()) {
      leaveCompanion(threadId);
      return;
    }
    leaveCompanion();
    if (threadId !== undefined) void navigate({ to: "/t/$threadId", params: { threadId } });
  };
  const start = () => {
    if (workspace === undefined) return;
    setStarting(true);
    void api
      .openOrchestrator({ workspaceId: workspace.workspace.id })
      .catch((error: unknown) => console.error("companion: start orchestrator", error))
      .finally(() => setStarting(false));
  };
  return (
    <section
      data-testid="companion-bubble"
      aria-label="Gram companion"
      className="companion-glass companion-panel flex max-h-[min(36rem,calc(100dvh-6rem))] w-85 max-w-full flex-col gap-2.5 p-3"
    >
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {needs.slice(0, 2).map((item) => (
          <NeedsCard key={item.key} item={item} onOpen={openFull} />
        ))}
        {hosts.map((summary) => (
          <HostCard key={summary.thread.id} summary={summary} onOpen={openFull} />
        ))}
        <Tasks tasks={tasks} onOpen={openFull} />
        {target !== undefined ? (
          <Exchange summary={target} plan={plan} busy={busy} />
        ) : workspace !== undefined ? (
          <div className="flex flex-col items-start gap-2 text-body text-muted-foreground">
            <span>No orchestrator runs in {workspace.workspace.name} yet.</span>
            <Button size="sm" disabled={starting} onClick={start}>
              Start orchestrator
            </Button>
          </div>
        ) : (
          <span className="text-body text-muted-foreground">
            Add a workspace in full Gram to talk to it here.
          </span>
        )}
      </div>
      {target !== undefined && <Say summary={target} />}
    </section>
  );
}

const PLAN_MARK = { completed: "✓", inProgress: "•", pending: "○", cancelled: "–" } as const;
const STEP_MARK = { done: "✓", doing: "•", todo: "○" } as const;
const TASKS_SHOWN = 4;
const DONE_SHOWN = 2;

function Tasks({
  tasks,
  onOpen,
}: {
  tasks: readonly CompanionTask[];
  onOpen: (threadId?: ThreadId) => void;
}) {
  if (tasks.length === 0) return null;
  const live = tasks.filter((task) => task.phase !== "done");
  const done = tasks.filter((task) => task.phase === "done").slice(0, DONE_SHOWN);
  const shown = [...live, ...done].slice(0, TASKS_SHOWN);
  return (
    <section data-testid="companion-tasks" aria-label="Tasks" className="flex flex-col gap-0.5">
      <h2 className="flex justify-between text-meta text-subtle">
        <span>Tasks</span>
        {shown.length < tasks.length && <span>{tasksLine(tasks)}</span>}
      </h2>
      {shown.map((task) => (
        <button
          key={task.id}
          type="button"
          data-testid="companion-task"
          data-phase={task.phase}
          title={task.line === undefined ? task.title : `${task.title}\n${task.line}`}
          onClick={() => onOpen(task.id)}
          className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 text-left text-meta hover:bg-surface-2"
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

function Exchange({
  summary,
  plan: kept,
  busy,
}: {
  summary: ThreadSummary;
  plan: CompanionPlan | undefined;
  busy: ActiveTool | undefined;
}) {
  const threadId = summary.thread.id;
  const messages = useThreadFeed(threadId, (s) => s.messages);
  const plan = useThreadsStore((s) => s.plans[threadId]);
  const history = historyOf(messages);
  const lastReply = history.findLast((message) => message.role === "assistant");
  const step = activeTool(messages) ?? busy;
  const [expanded, setExpanded] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useSubscription(() => {
    const element = scroller.current;
    if (element === null) return undefined;
    const toEnd = () => {
      if (pinned.current) element.scrollTop = element.scrollHeight;
    };
    const onScroll = () => {
      pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
    };
    const observer = new ResizeObserver(toEnd);
    const watchAll = () => {
      observer.observe(element);
      for (const child of element.children) observer.observe(child);
      toEnd();
    };
    const added = new MutationObserver(watchAll);
    added.observe(element, { childList: true });
    element.addEventListener("scroll", onScroll, { passive: true });
    watchAll();
    return () => {
      observer.disconnect();
      added.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, []);
  return (
    <>
      <div
        ref={scroller}
        data-testid="companion-history"
        data-expanded={expanded || undefined}
        onWheel={() => setExpanded(true)}
        className={cn(
          "flex flex-col gap-2 overflow-y-auto overscroll-contain text-body leading-relaxed",
          expanded ? "max-h-104" : "max-h-48",
        )}
      >
        {history.map((message) =>
          message.role === "user" ? (
            <span
              key={message.id}
              className="companion-inset line-clamp-2 max-w-[85%] shrink-0 self-end rounded-lg px-2 py-1 text-meta text-muted-foreground"
            >
              {textOf(message)}
            </span>
          ) : (
            <div
              key={message.id}
              className="flex shrink-0 flex-col gap-1.5"
              data-testid={message === lastReply ? "companion-reply" : undefined}
            >
              {textOf(message) !== "" && <Markdown mode="static">{textOf(message)}</Markdown>}
              {message.parts.map((part, index) =>
                part.type === "data-mock" ? (
                  <MockCard key={index} threadId={threadId} mock={part.data} />
                ) : null,
              )}
            </div>
          ),
        )}
      </div>
      <PlanList plan={kept} todos={plan} />
      {step !== undefined && (
        <div
          data-testid="companion-step"
          className="flex min-w-0 items-center gap-1.5 font-mono text-meta text-muted-foreground"
        >
          <StatusDot state={step.waiting === true ? "needs" : "working"} still />
          <span className="truncate">{step.label}</span>
        </div>
      )}
    </>
  );
}

function Say({ summary }: { summary: ThreadSummary }) {
  const api = useApi();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useMountEffect(() => input.current?.focus({ preventScroll: true }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (message === "") return;
    setText("");
    const sent =
      summary.status === "running"
        ? api.steer(summary.thread.id, { text: message })
        : api.send(summary.thread.id, { text: message });
    void sent.catch((error: unknown) => {
      console.error("companion: send", error);
      setText(message);
    });
  };
  return (
    <form
      onSubmit={submit}
      className="companion-inset flex items-center gap-1.5 rounded-full py-1 pr-1 pl-3"
    >
      <label className="sr-only" htmlFor="companion-input">
        Message the orchestrator
      </label>
      <input
        id="companion-input"
        ref={input}
        autoComplete="off"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="icon-sm"
        className="rounded-full"
        aria-label="Send"
        disabled={text.trim() === ""}
      >
        <ArrowUp />
      </Button>
    </form>
  );
}

function NeedsCard({
  item,
  onOpen,
}: {
  item: NeedsYouItem;
  onOpen: (threadId?: ThreadId) => void;
}) {
  const actions = useNeedsYouActions();
  const options =
    item.ask !== undefined && !answersInFull(item.ask)
      ? item.ask.options
          .filter((o) => o.action.kind !== "open" && o.action.kind !== "board")
          .slice(0, 2)
      : [];
  return (
    <div
      role="group"
      aria-label={item.title}
      data-testid="companion-needs"
      className="companion-inset flex flex-col gap-1.5 rounded-xl px-2.5 py-2 text-meta"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot state="needs" />
          <strong className="truncate font-semibold">{item.title}</strong>
        </span>
        <span className="shrink-0 truncate text-subtle">{item.where}</span>
      </div>
      {item.command !== undefined && (
        <code className="font-mono text-meta break-all">{item.command}</code>
      )}
      <div className="flex items-center gap-1.5">
        {options.map((option, index) => (
          <Button
            key={option.label}
            size="xs"
            variant={index === 0 ? "default" : "outline"}
            onClick={() => actions.answer(item, option)}
          >
            {option.label}
          </Button>
        ))}
        {item.threadId !== undefined && (
          <Button size="xs" variant="link" onClick={() => onOpen(item.threadId)}>
            Open thread
          </Button>
        )}
      </div>
    </div>
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
