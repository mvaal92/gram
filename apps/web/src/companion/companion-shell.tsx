import type { ThreadId, ThreadSummary, UserInput, WorkspaceState } from "@gram/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowUp, Plus } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import { useApi } from "@/api/context";
import { useLayoutSync, useMountEffect, useSubscription } from "@/lib/effects";
import { Markdown } from "@/components/ai-elements/markdown";
import { cn } from "@/lib/utils";
import { MockCard } from "@/thread/mock-visuals";
import { Button } from "@/components/ui/button";
import { AttachmentChips } from "@/composer/attachment-chips";
import { useAttachments } from "@/composer/use-attachments";
import type { NeedsYouItem } from "@/orchestration/needs-you-items";
import { useNeedsYouList } from "@/orchestration/use-needs-you";
import { useOrchestratorLedger, useWorkspaces } from "@/orchestration/use-orchestration";
import { useThreadFeed } from "@/stores/feeds";
import { useThreadsStore } from "@/stores/threads";
import { useViewWorkspace } from "@/views/view-workspace";

import { CompanionPresence } from "./companion-avatar";
import { Peek } from "./companion-peek";
import {
  avatarState,
  hostThreads,
  historyOf,
  textOf,
  latestThread,
  needsPerson,
  ownLine,
  planHint,
  plansOf,
  shownPlan,
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
  const [expanded, setExpanded] = useState(false);
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
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setExpanded(false);
      }}
      className="companion-glass companion-panel relative flex max-h-[min(36rem,calc(100dvh-6rem))] w-85 max-w-full flex-col gap-2 p-3 pt-1.5"
    >
      <Peek
        threadId={target?.thread.id}
        needs={needs}
        hosts={hosts}
        tasks={tasks}
        plan={plan}
        busy={busy}
        onOpen={openFull}
      />
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        {target !== undefined ? (
          <Exchange summary={target} expanded={expanded} onExpand={() => setExpanded(true)} />
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

function Exchange({
  summary,
  expanded,
  onExpand,
}: {
  summary: ThreadSummary;
  expanded: boolean;
  onExpand: () => void;
}) {
  const threadId = summary.thread.id;
  const messages = useThreadFeed(threadId, (s) => s.messages);
  const history = historyOf(messages);
  const lastReply = history.findLast((message) => message.role === "assistant");
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
        onWheel={onExpand}
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
    </>
  );
}

function Say({ summary }: { summary: ThreadSummary }) {
  const api = useApi();
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const attachments = useAttachments({ threadId: summary.thread.id });
  useMountEffect(() => input.current?.focus({ preventScroll: true }));
  const ready = attachments.ready;
  const canSend = !attachments.uploading && (text.trim() !== "" || ready.length > 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    const message = text.trim();
    const sent: UserInput = {
      text: message,
      ...(ready.length > 0 ? { attachments: ready } : {}),
    };
    setText("");
    attachments.clear();
    const going =
      summary.status === "running"
        ? api.steer(summary.thread.id, sent)
        : api.send(summary.thread.id, sent);
    void going.catch((error: unknown) => {
      console.error("companion: send", error);
      setText(message);
      if (sent.attachments !== undefined) attachments.adopt(sent.attachments);
    });
  };
  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    attachments.add(event.dataTransfer.files);
  };
  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={onDrop}
      className="companion-inset flex flex-col gap-1.5 rounded-xl p-1"
    >
      <AttachmentChips
        items={attachments.items}
        onRemove={attachments.remove}
        className="px-1 pt-1"
      />
      <div className="flex items-center gap-1">
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          data-testid="companion-file-input"
          onChange={(event) => {
            if (event.target.files !== null) attachments.add(event.target.files);
            event.target.value = "";
          }}
        />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="rounded-full"
          aria-label="Attach files"
          title="Attach files"
          data-testid="companion-attach"
          onClick={() => picker.current?.click()}
        >
          <Plus />
        </Button>
        <label className="sr-only" htmlFor="companion-input">
          Message the orchestrator
        </label>
        <input
          id="companion-input"
          ref={input}
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            if (attachments.add(event.clipboardData.files)) event.preventDefault();
          }}
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          size="icon-sm"
          className="rounded-full"
          aria-label="Send"
          disabled={!canSend}
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
