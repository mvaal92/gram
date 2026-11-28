import type {
  GramUIMessage,
  OrchestratorLedger,
  ThreadId,
  ThreadPlan,
  ThreadSummary,
  WorkerLedgerEntry,
} from "@gram/contracts";

import { isToolPart, toolNameOf, toolPhase, type AnyToolPart } from "@/thread/parts";
import { stepLabel } from "@/thread/tool-group-model";

export type AvatarState = "idle" | "working" | "error";

/** What the tool under way is, for the avatar's glyph. */
export type ToolKind = "terminal" | "search" | "file" | "worker" | "web" | "other";

export interface ActiveTool {
  readonly kind: ToolKind;
  /** The step in a few words, as the transcript's collapsed line names it. */
  readonly label: string;
  /** It waits on the person rather than working. */
  readonly waiting?: true;
}

/** The avatar's mood: its own thread failed, or something it watches runs, or it rests. */
export function avatarState(
  own: Pick<ThreadSummary, "status"> | undefined,
  threads: readonly Pick<ThreadSummary, "status">[],
): AvatarState {
  if (own?.status === "error") return "error";
  if (threads.some((t) => t.status === "running" || t.status === "starting")) return "working";
  return "idle";
}

/** Whether anything waits on the person: an ask in Needs you, or a thread held at an approval. */
export const needsPerson = (
  threads: readonly Pick<ThreadSummary, "status">[],
  needsYou: number,
): boolean =>
  needsYou > 0 || threads.some((t) => t.status === "needsApproval" || t.status === "needsInput");

/**
 * What the orchestrator's workers are doing, for the hint: how many run, and what the first of
 * them is at ("2 workers · Running tests"). Nothing while none runs.
 */
export function workersLine(
  threads: readonly ThreadSummary[],
  own: ThreadId | undefined,
): ActiveTool | undefined {
  const running = threads.filter(
    (t) => t.thread.id !== own && (t.status === "running" || t.status === "starting"),
  );
  if (running.length === 0) return undefined;
  const count = `${running.length} worker${running.length === 1 ? "" : "s"}`;
  const doing = running.find((t) => t.activity !== undefined && t.activity.trim() !== "")?.activity;
  return {
    kind: "worker",
    label: doing === undefined ? `${count} · working` : `${count} · ${doing}`,
  };
}

export const textOf = (message: GramUIMessage): string =>
  message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();

const fromGram = (message: GramUIMessage): boolean =>
  message.metadata?.author === "server" ||
  message.parts.some((part) => part.type.startsWith("data-"));

/** The person's last words and the agent's reply after them, which is all the bubble shows. */
export function lastExchange(messages: readonly GramUIMessage[]): {
  readonly asked: string | undefined;
  readonly reply: string | undefined;
  readonly replyId?: string;
} {
  let reply: { text: string; id: string } | undefined;
  const found = (asked: string | undefined) =>
    reply === undefined
      ? { asked, reply: undefined }
      : { asked, reply: reply.text, replyId: reply.id };
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const text = textOf(message);
    if (text === "") continue;
    if (message.role === "user") {
      if (fromGram(message)) continue;
      return found(text);
    }
    reply ??= { text, id: message.id };
  }
  return found(undefined);
}

const kindOf = (tool: string): ToolKind => {
  if (/spawn_worker|send_message|message_orchestrator|code_(threads|workers|projects)/u.test(tool))
    return "worker";
  if (/^(Bash|BashOutput|exec|shell)$|command/u.test(tool)) return "terminal";
  if (/^(Grep|Glob|search)|_search|find/u.test(tool)) return "search";
  if (/^(Read|Write|Edit|MultiEdit|NotebookEdit)$|file/u.test(tool)) return "file";
  if (/Web|browser_|fetch|navigate/u.test(tool)) return "web";
  return "other";
};

/** The call still running in the latest turn, or `undefined` when none is. */
export function activeTool(messages: readonly GramUIMessage[]): ActiveTool | undefined {
  const last = messages.at(-1);
  if (last === undefined || last.role !== "assistant") return undefined;
  const running = last.parts.filter(isToolPart).findLast((part: AnyToolPart) => {
    const phase = toolPhase(
      part.state,
      part.state === "output-error" ? part.errorText : undefined,
      part.state === "output-available" && part.preliminary === true,
    );
    return phase === "running" || phase === "pending";
  });
  if (running === undefined) return undefined;
  const kind = kindOf(toolNameOf(running));
  if (running.state === "input-streaming") return { kind, label: "Working…" };
  return { kind, label: stepLabel(running) };
}

/**
 * Threads a host started for the person, or owns a conversation of (`Thread.conversations`): what
 * an embedding host's service calls and chat apps make through `/embed/v1/thread-starts`. Live
 * first, most recent first, at most `limit`.
 */
export function hostThreads(
  threads: readonly ThreadSummary[],
  limit = 3,
): readonly ThreadSummary[] {
  return threads
    .filter(
      (t) =>
        (t.thread.conversations?.length ?? 0) > 0 &&
        t.status !== "ended" &&
        t.thread.parked !== true,
    )
    .toSorted(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        b.thread.lastActivityAt - a.thread.lastActivityAt,
    )
    .slice(0, limit);
}

/** Where a host thread came from, as the host labelled its conversation. */
export const hostLabel = (summary: ThreadSummary): string =>
  summary.thread.conversations?.find((c) => c.label !== undefined)?.label ?? "From a host";

/** The thread to talk to without a workspace orchestrator: the latest one still open. */
export const latestThread = (
  threads: readonly ThreadSummary[],
): ThreadSummary["thread"]["id"] | undefined =>
  threads
    .filter(
      (t) => t.thread.parked !== true && t.status !== "ended" && t.thread.spawnedBy === undefined,
    )
    .toSorted((a, b) => b.thread.lastActivityAt - a.thread.lastActivityAt)[0]?.thread.id;

/** The first `max` characters of `text` on one line, cut at a word, for the avatar's speech drop. */
export const excerpt = (text: string, max: number): string => {
  const line = text
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/https?:\/\/\S+/gu, "")
    .replace(/(?:~|\/[\w.-]+)(?:\/[\w.-]+)+\/([\w.-]+)/gu, "$1")
    .replace(/[#*_`>]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/**
 * What the companion's own thread is doing in words, for when no tool call names it: waiting on
 * the person, the server's live activity line, or just working.
 */
export function ownLine(
  summary: Pick<ThreadSummary, "status" | "activity" | "pendingRequests"> | undefined,
  somethingHereNeedsYou = false,
): ActiveTool | undefined {
  if (summary === undefined) return undefined;
  if (
    somethingHereNeedsYou ||
    summary.status === "needsApproval" ||
    summary.status === "needsInput" ||
    summary.pendingRequests.length > 0
  )
    return { kind: "other", label: "Waiting for you", waiting: true };
  if (summary.activity !== undefined && summary.activity.trim() !== "")
    return { kind: "other", label: summary.activity };
  if (summary.status === "running" || summary.status === "starting")
    return { kind: "other", label: "Working…" };
  return undefined;
}

/** What drops out of the icon while the dropdown is closed: a new ask, a task's end, or a reply. */
export interface Drop {
  readonly key: string;
  readonly tone: "reply" | "needs" | "done" | "failed";
  readonly text: string;
  /** The task it ends, for a `done` or `failed` drop. */
  readonly title?: string;
  /** The heading's word when it isn't the tone's own: "Blocked" for a task that stopped short. */
  readonly word?: string;
}

/** A reply as the drops see it: its message, so the same reply never speaks twice. */
export interface SeenReply {
  readonly id: string;
  readonly text: string;
}

/** What the drops have already noticed, so only something new speaks. */
export interface DropSeen {
  /** Every reply already shown or already there when the thread loaded. */
  readonly replies: readonly string[];
  readonly keys: readonly string[];
  /** Task endings already noticed, by `endingKey`. */
  readonly endings: readonly string[];
  /** The thread's messages were in, so a reply that comes now is new rather than loaded. */
  readonly loaded: boolean;
  /** The tasks were in, so a task that ends now is news rather than history. */
  readonly tasksLoaded: boolean;
}

const SEEN_KEEP = 200;
const keep = (list: readonly string[], add: string | undefined): readonly string[] =>
  add === undefined || list.includes(add) ? list : [...list, add].slice(-SEEN_KEEP);

/**
 * What changed since `seen`: a new ask drops out first, then a task that ended, then a reply once
 * the turn that wrote it has settled. A reply is known by its message, so one that shows again
 * after a tool call, a worker's report or a reload never drops out a second time. Nothing speaks
 * while the dropdown is open or before the thread's messages are in.
 */
export function noticeDrops(
  seen: DropSeen,
  now: {
    readonly reply: SeenReply | undefined;
    /** The turn that wrote `reply` is over: nothing runs and nothing streams. */
    readonly settled: boolean;
    readonly needs: readonly { readonly key: string; readonly title: string }[];
    readonly endings: readonly CompanionTask[];
    /** The tasks are in; until they are, every ending is history. */
    readonly tasksLoaded: boolean;
    readonly loaded: boolean;
    readonly open: boolean;
  },
): {
  readonly seen: DropSeen;
  readonly ask?: Drop;
  readonly ended?: Drop;
  readonly reply?: Drop;
} {
  const keys = now.needs.map((item) => item.key);
  const speaks = seen.loaded && !now.open;
  const fresh = now.needs.find((item) => !seen.keys.includes(item.key));
  const ask: Drop | undefined =
    speaks && fresh !== undefined
      ? { key: fresh.key, tone: "needs", text: excerpt(fresh.title, 90) }
      : undefined;
  const newEnding = now.endings.find((task) => !seen.endings.includes(endingKey(task)));
  const ended: Drop | undefined =
    speaks && seen.tasksLoaded && ask === undefined && newEnding !== undefined
      ? {
          key: `end:${endingKey(newEnding)}`,
          tone: newEnding.phase === "failed" ? "failed" : "done",
          title: newEnding.title,
          ...(newEnding.blocked === true ? { word: "Blocked" } : {}),
          text: excerpt(newEnding.line ?? newEnding.title, 140),
        }
      : undefined;
  const replyNew =
    now.reply !== undefined && now.settled && !seen.replies.includes(now.reply.id)
      ? now.reply
      : undefined;
  const reply: Drop | undefined =
    speaks && ask === undefined && replyNew !== undefined
      ? { key: `reply:${replyNew.id}`, tone: "reply", text: excerpt(replyNew.text, 160) }
      : undefined;
  const quiet = !speaks;
  const replies =
    quiet && now.reply !== undefined
      ? keep(seen.replies, now.reply.id)
      : keep(seen.replies, reply === undefined ? undefined : replyNew?.id);
  const endings = now.endings
    .map(endingKey)
    .filter(() => quiet || !seen.tasksLoaded || ended !== undefined)
    .reduce(keep, seen.endings);
  return {
    seen: { replies, keys, endings, loaded: now.loaded, tasksLoaded: now.tasksLoaded },
    ...(ask === undefined ? {} : { ask }),
    ...(ended === undefined ? {} : { ended }),
    ...(reply === undefined ? {} : { reply }),
  };
}

/** Where a task the companion follows stands, in the four words a person needs. */
export type TaskPhase = "doing" | "needs" | "done" | "failed";

/** One piece of work the companion follows: a worker its orchestrator started. */
export interface CompanionTask {
  readonly id: ThreadId;
  readonly title: string;
  readonly phase: TaskPhase;
  /** What it is at, what it asks, how it ended or why it failed, in a few words. */
  readonly line?: string;
  /** It stopped short and says why (`blocked`), rather than failing outright. */
  readonly blocked?: true;
  /** Plan progress while it works, as `2/4`. */
  readonly progress?: string;
  readonly at: number;
}

const PHASE_OF: Record<WorkerLedgerEntry["state"], TaskPhase | undefined> = {
  briefed: "doing",
  working: "doing",
  needsUser: "needs",
  question: "needs",
  blocked: "failed",
  done: "done",
  inReview: "done",
  readyToMerge: "done",
  delivered: "done",
  merged: "done",
  error: "failed",
  archived: undefined,
};

const taskOf = (worker: WorkerLedgerEntry): CompanionTask | undefined => {
  const phase = worker.status === "error" ? "failed" : PHASE_OF[worker.state];
  if (phase === undefined) return undefined;
  const report = worker.lastReport?.summary.trim();
  const line =
    phase === "failed"
      ? (worker.lastError?.text ?? report)
      : phase === "needs"
        ? "asks you"
        : phase === "done"
          ? report
          : (worker.activity ?? worker.plan?.headline ?? worker.nextStep);
  const progress =
    phase === "doing" && worker.plan !== undefined && worker.plan.total > 0
      ? `${worker.plan.done}/${worker.plan.total}`
      : undefined;
  return {
    id: worker.threadId,
    title: worker.title,
    phase,
    ...(line === undefined || line === "" ? {} : { line }),
    ...(progress === undefined ? {} : { progress }),
    ...(worker.state === "blocked" && worker.status !== "error" ? { blocked: true as const } : {}),
    at: worker.lastReport?.at ?? 0,
  };
};

const PHASE_RANK: Record<TaskPhase, number> = { needs: 0, doing: 1, failed: 2, done: 3 };

/**
 * The tasks the companion follows for the person: every worker in the orchestrator's ledger but
 * the archived, what asks first, then what runs, then how the rest ended, newest first.
 */
export function tasksOf(
  ledger: Pick<OrchestratorLedger, "features"> | undefined,
): readonly CompanionTask[] {
  if (ledger === undefined) return [];
  return ledger.features
    .flatMap((feature) => feature.workers)
    .flatMap((worker) => taskOf(worker) ?? [])
    .toSorted((a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || b.at - a.at);
}

/** A task's ending, as the drops and pings know it: the same ending never speaks twice. */
export const endingKey = (task: Pick<CompanionTask, "id" | "phase">): string =>
  `${task.id}:${task.phase}`;

/** The tasks that have ended, done or failed. */
export const endingsOf = (tasks: readonly CompanionTask[]): readonly CompanionTask[] =>
  tasks.filter((task) => task.phase === "done" || task.phase === "failed");

/** The counts the hint and the tasks heading show: "2 running · 1 done". */
export function tasksLine(tasks: readonly CompanionTask[]): string | undefined {
  const count = (phase: TaskPhase | "blocked") =>
    tasks.filter((task) =>
      phase === "blocked"
        ? task.blocked === true
        : task.phase === phase && !(phase === "failed" && task.blocked === true),
    ).length;
  const parts = (
    [
      ["needs", "asks you"],
      ["doing", "running"],
      ["blocked", "blocked"],
      ["failed", "failed"],
      ["done", "done"],
    ] as const
  )
    .map(([phase, words]) => ({ n: count(phase), words }))
    .filter(({ n }) => n > 0)
    .map(({ n, words }) => `${n} ${words}`);
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/** A plan the orchestrator keeps for one piece of work: its stages and the one it stands on. */
export interface CompanionPlan {
  readonly title: string;
  readonly steps: readonly { readonly text: string; readonly status: "done" | "doing" | "todo" }[];
  readonly done: number;
  readonly total: number;
  readonly current?: string;
  /** When its stage last moved, so the latest plan leads. */
  readonly at?: number;
  /** The tasks that carry it out. */
  readonly taskIds?: readonly string[];
}

/**
 * The orchestrator's plans (a feature's stages, `set_stage`), live ones first: what the bubble
 * lists and the hint counts. A finished feature's plan reads as all done.
 */
export function plansOf(
  ledger: Pick<OrchestratorLedger, "features" | "groups"> | undefined,
): readonly CompanionPlan[] {
  if (ledger === undefined) return [];
  const staged = [
    ...(ledger.groups ?? []).map((group) => ({
      title: group.group,
      state: group.state,
      stage: group.stage,
      taskIds: ledger.features
        .filter((feature) => group.features.includes(feature.feature))
        .flatMap((feature) => feature.workers.map((worker) => worker.threadId)),
    })),
    ...ledger.features
      .filter((feature) => feature.group === undefined)
      .map((feature) => ({
        title: feature.workers.at(-1)?.title ?? feature.feature,
        state: feature.state,
        stage: feature.stage,
        taskIds: feature.workers.map((worker) => worker.threadId),
      })),
  ];
  return staged
    .flatMap(({ title, state, stage, taskIds }) => {
      if (stage === undefined) return [];
      const list = stage.plan ?? [];
      const finished =
        PHASE_OF[state] === "done" && (list.length === 0 || stage.stage === list.at(-1));
      const at = finished ? list.length : Math.max(0, list.indexOf(stage.stage));
      const steps = list.map((text, index) => ({
        text,
        status:
          index < at ? ("done" as const) : index === at ? ("doing" as const) : ("todo" as const),
      }));
      return [
        {
          title,
          steps,
          done: at,
          total: steps.length,
          ...(finished ? {} : { current: stage.stage }),
          at: stage.setAt,
          taskIds,
        },
      ];
    })
    .toSorted(
      (a, b) =>
        Number(a.current === undefined) - Number(b.current === undefined) ||
        (b.at ?? 0) - (a.at ?? 0),
    );
}

/**
 * The plan worth showing: one under way, else the last one to finish while nothing newer has
 * started since; once other work begins, a finished plan steps aside.
 */
export function shownPlan(
  plans: readonly CompanionPlan[],
  tasks: readonly CompanionTask[],
): CompanionPlan | undefined {
  const [first] = plans;
  if (first === undefined || first.current !== undefined) return first;
  const newest = tasks.toSorted((a, b) => b.at - a.at)[0];
  return newest === undefined || (first.taskIds ?? []).includes(newest.id) ? first : undefined;
}

/** A thread's own plan (`set_plan`) in the same shape, for a solo thread the companion talks to. */
export function threadPlanOf(
  plan: Pick<ThreadPlan, "goal" | "steps"> | undefined,
): CompanionPlan | undefined {
  const line = planLine(plan);
  if (plan === undefined || line === undefined) return undefined;
  return {
    title: plan.goal,
    steps: plan.steps
      .filter((step) => step.status !== "dropped")
      .map((step) => ({
        text: step.text,
        status: step.status === "done" ? "done" : step.status === "todo" ? "todo" : "doing",
      })),
    done: line.done,
    total: line.total,
    ...(line.current === undefined ? {} : { current: line.current }),
  };
}

/** Where a plan stands, for the hint: "Step 2 of 3 · Review". */
export const planHint = (plan: CompanionPlan | undefined): string | undefined =>
  plan?.current === undefined
    ? undefined
    : plan.total === 0
      ? plan.current
      : `Step ${Math.min(plan.done + 1, plan.total)} of ${plan.total} · ${plan.current}`;

/** The plan's progress in a few words: its step under way and how far along it is. */
export function planLine(
  plan: Pick<ThreadPlan, "goal" | "steps"> | undefined,
): { readonly done: number; readonly total: number; readonly current?: string } | undefined {
  if (plan === undefined) return undefined;
  const steps = plan.steps.filter((step) => step.status !== "dropped");
  if (steps.length === 0) return undefined;
  const current =
    steps.find((step) => step.status === "doing") ??
    steps.find((step) => step.status === "blocked") ??
    steps.find((step) => step.status === "todo");
  return {
    done: steps.filter((step) => step.status === "done").length,
    total: steps.length,
    ...(current === undefined ? {} : { current: current.text }),
  };
}

/** The bubble's history: the last `limit` messages with words or a mock, the person's own and the agent's. */
export function historyOf(
  messages: readonly GramUIMessage[],
  limit = 12,
): readonly GramUIMessage[] {
  return messages
    .filter((message) =>
      message.role === "user"
        ? !fromGram(message) && textOf(message) !== ""
        : textOf(message) !== "" || message.parts.some((part) => part.type === "data-mock"),
    )
    .slice(-limit);
}

/** The bubble's one top line: what asks, else where the work stands, else how the tasks ended. */
export interface TopLine {
  readonly tone: "needs" | "working" | "stuck" | "quiet";
  readonly text: string;
}

/**
 * What the top line says. Only `needs` shows at rest; the rest waits for the pointer, so the chat
 * keeps nothing but messages.
 */
export function topLineOf({
  needs,
  step,
  plan,
  tasks,
}: {
  needs: readonly { readonly title: string }[];
  step: ActiveTool | undefined;
  plan: CompanionPlan | undefined;
  tasks: readonly CompanionTask[];
}): TopLine | undefined {
  const [first] = needs;
  if (first !== undefined)
    return {
      tone: "needs",
      text: `${needs.length === 1 ? "Asks you" : `${needs.length} ask you`} · ${first.title}`,
    };
  if (step !== undefined)
    return { tone: step.waiting === true ? "needs" : "working", text: step.label };
  const where = planHint(plan);
  if (where !== undefined) return { tone: "working", text: where };
  const counts = tasksLine(tasks);
  if (counts === undefined) return undefined;
  return {
    tone: tasks.some((task) => task.phase === "failed") ? "stuck" : "quiet",
    text: counts,
  };
}
