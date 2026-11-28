import type { GramUIMessage, ThreadId, ThreadSummary } from "@gram/contracts";

import { isToolPart, toolNameOf, toolPhase, type AnyToolPart } from "@/thread/parts";
import { stepLabel } from "@/thread/tool-group-model";

export type AvatarState = "idle" | "working" | "error";

/** What the tool under way is, for the avatar's glyph. */
export type ToolKind = "terminal" | "search" | "file" | "worker" | "web" | "other";

export interface ActiveTool {
  readonly kind: ToolKind;
  /** The step in a few words, as the transcript's collapsed line names it. */
  readonly label: string;
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

/** What a running worker is doing, for the working line when the companion's own turn names none. */
export function workerLine(
  threads: readonly ThreadSummary[],
  own: ThreadId | undefined,
): ActiveTool | undefined {
  const busy = threads.find(
    (t) => t.thread.id !== own && t.status === "running" && t.activity !== undefined,
  );
  return busy === undefined
    ? undefined
    : { kind: "worker", label: `${busy.activity} · ${busy.thread.title}` };
}

const textOf = (message: GramUIMessage): string =>
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
} {
  let reply: string | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    const text = textOf(message);
    if (text === "") continue;
    if (message.role === "user") {
      if (fromGram(message)) continue;
      return { asked: text, reply };
    }
    reply ??= text;
  }
  return { asked: undefined, reply };
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
  return { kind: kindOf(toolNameOf(running)), label: stepLabel(running) };
}

/**
 * Threads a host started for the person, or owns a conversation of (`Thread.conversations`): what
 * Runheim's `code_threads_*` calls and its chat apps make through `/embed/v1/thread-starts`. Live
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
    return { kind: "other", label: "Waiting for you" };
  if (summary.activity !== undefined && summary.activity.trim() !== "")
    return { kind: "other", label: summary.activity };
  if (summary.status === "running" || summary.status === "starting")
    return { kind: "other", label: "Working…" };
  return undefined;
}

/** What drops out of the icon while the dropdown is closed: a new ask, or a new reply. */
export interface Drop {
  readonly key: string;
  readonly tone: "reply" | "needs";
  readonly text: string;
}

/** What the drops have already noticed, so only something new speaks. */
export interface DropSeen {
  readonly reply: string | undefined;
  readonly keys: readonly string[];
  /** The thread's messages were in, so a reply that changes now is new rather than loaded. */
  readonly loaded: boolean;
  /** Replies dropped so far, which keeps each reply's drop its own even when two read alike. */
  readonly count: number;
}

/**
 * What changed since `seen`: a new ask drops out ahead of a new reply, and nothing does while
 * the dropdown is open or before the thread's messages are in.
 */
export function noticeDrops(
  seen: DropSeen,
  now: {
    readonly reply: string | undefined;
    readonly needs: readonly { readonly key: string; readonly title: string }[];
    readonly loaded: boolean;
    readonly open: boolean;
  },
): { readonly seen: DropSeen; readonly ask?: Drop; readonly reply?: Drop } {
  const keys = now.needs.map((item) => item.key);
  const speaks = seen.loaded && !now.open;
  const fresh = now.needs.find((item) => !seen.keys.includes(item.key));
  const ask: Drop | undefined =
    speaks && fresh !== undefined
      ? { key: fresh.key, tone: "needs", text: excerpt(fresh.title, 90) }
      : undefined;
  const reply: Drop | undefined =
    speaks && ask === undefined && now.reply !== undefined && now.reply !== seen.reply
      ? { key: `reply:${seen.count + 1}`, tone: "reply", text: excerpt(now.reply, 160) }
      : undefined;
  return {
    seen: {
      reply: now.reply,
      keys,
      loaded: now.loaded,
      count: seen.count + (reply === undefined ? 0 : 1),
    },
    ...(ask === undefined ? {} : { ask }),
    ...(reply === undefined ? {} : { reply }),
  };
}
