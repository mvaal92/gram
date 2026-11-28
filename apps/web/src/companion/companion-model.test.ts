import type { GramUIMessage } from "@gram/contracts";
import { describe, expect, it } from "vitest";

import {
  activeTool,
  avatarState,
  excerpt,
  historyOf,
  lastExchange,
  needsPerson,
  noticeDrops,
  ownLine,
  planHint,
  planLine,
  plansOf,
  shownPlan,
  tasksLine,
  tasksOf,
  workersLine,
} from "./companion-model";

const message = (role: "user" | "assistant", parts: unknown[]): GramUIMessage =>
  ({ id: `${role}-${parts.length}`, role, parts }) as unknown as GramUIMessage;

describe("avatarState", () => {
  it("is red only when its own thread failed, and works while anything it watches runs", () => {
    expect(avatarState({ status: "error" }, [{ status: "running" }])).toBe("error");
    expect(avatarState({ status: "idle" }, [{ status: "error" }, { status: "running" }])).toBe(
      "working",
    );
    expect(avatarState({ status: "idle" }, [{ status: "error" }])).toBe("idle");
  });

  it("needs the person for an ask or a thread held at an approval, working or not", () => {
    expect(needsPerson([{ status: "running" }], 1)).toBe(true);
    expect(needsPerson([{ status: "needsApproval" }], 0)).toBe(true);
    expect(needsPerson([{ status: "running" }], 0)).toBe(false);
  });
});

describe("lastExchange", () => {
  it("pairs the person's last words with the reply after them, not an older one", () => {
    const messages = [
      message("user", [{ type: "text", text: "first" }]),
      message("assistant", [{ type: "text", text: "old reply" }]),
      message("user", [{ type: "text", text: "second" }]),
    ];
    expect(lastExchange(messages)).toEqual({ asked: "second", reply: undefined });
    messages.push(message("assistant", [{ type: "text", text: "new reply" }]));
    expect(lastExchange(messages)).toMatchObject({ asked: "second", reply: "new reply" });
    messages.push(
      message("user", [
        { type: "text", text: "3 threads changed" },
        { type: "data-orchestration-digest", data: {} },
      ]),
    );
    expect(lastExchange(messages).asked).toBe("second");
  });
});

describe("activeTool", () => {
  it("names the running call of the latest turn and none once it has finished", () => {
    const running = {
      type: "tool-Bash",
      toolCallId: "1",
      state: "input-available",
      input: { command: "bun run test" },
    };
    expect(activeTool([message("assistant", [running])])?.kind).toBe("terminal");
    expect(
      activeTool([message("assistant", [{ ...running, state: "output-available", output: "" }])]),
    ).toBeUndefined();
  });
});

describe("excerpt", () => {
  it("keeps a short reply whole and cuts a long one at a word, on one line", () => {
    expect(excerpt("**Done.**\n\nAll green.", 40)).toBe("Done. All green.");
    expect(excerpt("one two three four five six seven", 20)).toBe("one two three four…");
  });
});

describe("ownLine", () => {
  it("names what the companion's thread is doing when no tool call does", () => {
    const none: never[] = [];
    expect(ownLine({ status: "needsApproval", pendingRequests: none })?.label).toBe(
      "Waiting for you",
    );
    expect(
      ownLine({
        status: "running",
        activity: "Writing the recap",
        pendingRequests: [{} as never],
      })?.label,
    ).toBe("Waiting for you");
    expect(
      ownLine({ status: "running", activity: "Reading the README", pendingRequests: none })?.label,
    ).toBe("Reading the README");
    expect(ownLine({ status: "running", pendingRequests: none })?.label).toBe("Working…");
    expect(
      ownLine({ status: "running", activity: "Writing the recap", pendingRequests: none }, true)
        ?.label,
    ).toBe("Waiting for you");
    expect(ownLine({ status: "idle", pendingRequests: none })).toBeUndefined();
  });
});

const task = (id: string, phase: "done" | "failed") =>
  ({ id, title: `Task ${id}`, phase, line: `${id} ${phase}`, at: 1 }) as never;

const worker = (threadId: string, state: string, extra: object = {}) =>
  ({ threadId, title: threadId, state, status: "idle", ...extra }) as never;

const step = (text: string, status: string) => ({ id: text, text, status }) as never;

describe("excerpt", () => {
  it("names a file by its own name, not its whole path", () => {
    expect(
      excerpt("Created /home/x/work/.worktrees/a-b/companion-check.txt with one line", 80),
    ).toBe("Created companion-check.txt with one line");
  });
});

describe("noticeDrops", () => {
  const seen = { replies: ["m1"], keys: [], endings: [], loaded: true, tasksLoaded: true };
  const now = {
    reply: { id: "m1", text: "Done: two lines." },
    settled: true,
    needs: [],
    endings: [],
    tasksLoaded: true,
    loaded: true,
    open: false,
  };

  it("drops each new reply once, never the earlier one again when it shows after a tool call", () => {
    const first = noticeDrops(seen, { ...now, reply: { id: "m2", text: "Started a worker" } });
    expect(first.reply?.text).toBe("Started a worker");
    const midTurn = noticeDrops(first.seen, { ...now, reply: undefined, settled: false });
    expect(midTurn.reply).toBeUndefined();
    const back = noticeDrops(midTurn.seen, {
      ...now,
      reply: { id: "m2", text: "Started a worker" },
    });
    expect(back.reply).toBeUndefined();
  });

  it("waits for the turn to settle before a reply drops", () => {
    const streaming = noticeDrops(seen, {
      ...now,
      reply: { id: "m3", text: "Look" },
      settled: false,
    });
    expect(streaming.reply).toBeUndefined();
    const settled = noticeDrops(streaming.seen, {
      ...now,
      reply: { id: "m3", text: "Looked: all fine." },
    });
    expect(settled.reply?.text).toBe("Looked: all fine.");
  });

  it("drops a task's end once, failed or done, and not what had ended before it loaded", () => {
    const loading = noticeDrops(
      { ...seen, loaded: false },
      { ...now, endings: [task("old", "done")] },
    );
    expect(loading.ended).toBeUndefined();
    const ledgerLate = noticeDrops(
      { ...seen, tasksLoaded: false },
      { ...now, endings: [task("older", "done")] },
    );
    expect(ledgerLate.ended).toBeUndefined();
    expect(
      noticeDrops(ledgerLate.seen, { ...now, endings: [task("older", "done")] }).ended,
    ).toBeUndefined();
    const failed = noticeDrops(loading.seen, {
      ...now,
      endings: [task("old", "done"), task("w1", "failed")],
    });
    expect(failed.ended).toMatchObject({ tone: "failed", title: "Task w1", text: "w1 failed" });
    const again = noticeDrops(failed.seen, {
      ...now,
      endings: [task("old", "done"), task("w1", "failed")],
    });
    expect(again.ended).toBeUndefined();
  });

  it("puts a new ask ahead of a reply, and says nothing while open or loading", () => {
    const fresh = { ...now, reply: { id: "m4", text: "Next" } };
    const asked = noticeDrops(seen, { ...fresh, needs: [{ key: "a", title: "Allow Edit" }] });
    expect(asked.ask?.text).toBe("Allow Edit");
    expect(asked.reply).toBeUndefined();
    const open = noticeDrops(seen, { ...fresh, open: true });
    expect(open.reply).toBeUndefined();
    expect(noticeDrops(open.seen, fresh).reply).toBeUndefined();
    expect(noticeDrops({ ...seen, loaded: false }, fresh).reply).toBeUndefined();
  });
});

describe("tasksOf", () => {
  it("lists what asks, then what runs with its plan progress, then how the rest ended", () => {
    const tasks = tasksOf({
      features: [
        {
          workers: [
            worker("done", "delivered", { lastReport: { summary: "Added it", at: 2 } }),
            worker("run", "working", { status: "running", plan: { done: 1, total: 3 } }),
            worker("ask", "needsUser"),
            worker("gone", "archived"),
            worker("bad", "working", { status: "error", lastError: { text: "Usage limit" } }),
          ],
        },
      ],
    } as never);
    expect(tasks.map((t) => [t.id, t.phase])).toEqual([
      ["ask", "needs"],
      ["run", "doing"],
      ["bad", "failed"],
      ["done", "done"],
    ]);
    expect(tasks[1]?.progress).toBe("1/3");
    expect(tasks[2]?.line).toBe("Usage limit");
    expect(tasksLine(tasks)).toBe("1 asks you · 1 running · 1 failed · 1 done");
  });
});

const feature = (state: string, stage: string) =>
  ({
    feature: "f",
    state,
    stage: { plan: ["one", "two", "three"], stage },
    workers: [],
  }) as never;

describe("plansOf", () => {
  it("reads a feature's stages as a plan standing on its stage, and a finished one as all done", () => {
    const [live] = plansOf({ features: [feature("working", "two")] });
    expect(live).toMatchObject({ done: 1, total: 3, current: "two" });
    expect(planHint(live)).toBe("Step 2 of 3 · two");
    const [between] = plansOf({ features: [feature("delivered", "one")] });
    expect(planHint(between)).toBe("Step 1 of 3 · one");
    const [ended] = plansOf({ features: [feature("delivered", "three")] });
    expect(ended).toMatchObject({ done: 3, total: 3 });
    expect(planHint(ended)).toBeUndefined();
    const [grouped] = plansOf({
      features: [],
      groups: [{ group: "plan-check", state: "working", stage: { stage: "Step 2" } }],
    } as never);
    expect(planHint(grouped)).toBe("Step 2");
    const latest = plansOf({
      features: [],
      groups: [
        { group: "old", state: "delivered", stage: { stage: "b", plan: ["a", "b"], setAt: 1 } },
        { group: "new", state: "delivered", stage: { stage: "b", plan: ["a", "b"], setAt: 2 } },
      ],
    } as never);
    expect(latest[0]?.title).toBe("new");
  });
});

const doneTask = (id: string, at: number) => ({ id, title: id, phase: "done", at }) as never;

describe("shownPlan", () => {
  it("keeps a finished plan until other work starts, and a live one always", () => {
    const done = { title: "p", steps: [], done: 2, total: 2, taskIds: ["w1"] };
    expect(shownPlan([done], [doneTask("w1", 2), doneTask("w0", 1)])).toBe(done);
    expect(shownPlan([done], [doneTask("w1", 2), doneTask("w9", 3)])).toBeUndefined();
    const live = { ...done, current: "b" };
    expect(shownPlan([live], [doneTask("w9", 3)])).toBe(live);
  });
});

describe("planLine", () => {
  it("counts the steps done, leaves dropped ones out and names the one under way", () => {
    expect(
      planLine({
        goal: "Ship",
        steps: [step("a", "done"), step("b", "doing"), step("c", "todo"), step("d", "dropped")],
      }),
    ).toEqual({ done: 1, total: 3, current: "b" });
  });
});

const thread = (id: string, status: string, activity?: string) =>
  ({ thread: { id }, status, ...(activity === undefined ? {} : { activity }) }) as never;

describe("workersLine", () => {
  it("counts the running workers, leaves the orchestrator out, and names what one is doing", () => {
    const threads = [
      thread("orch", "running", "Reading the ledger"),
      thread("w1", "running", "Running tests"),
      thread("w2", "starting"),
      thread("w3", "idle"),
    ];
    expect(workersLine(threads, "orch" as never)?.label).toBe("2 workers · Running tests");
    expect(workersLine([thread("orch", "running")], "orch" as never)).toBeUndefined();
  });
});

describe("historyOf", () => {
  it("keeps the person's and the agent's words and mocks, not Gram's notices, the latest last", () => {
    const messages = [
      message("user", [{ type: "text", text: "do it" }]),
      message("user", [
        { type: "text", text: "digest" },
        { type: "data-orchestration-digest", data: {} },
      ]),
      message("assistant", [{ type: "tool-Bash", state: "input-available", input: {} }]),
      message("assistant", [{ type: "data-mock", data: {} }]),
      message("assistant", [{ type: "text", text: "done" }]),
    ];
    expect(historyOf(messages).map((m) => m.parts[0]?.type)).toEqual(["text", "data-mock", "text"]);
    expect(historyOf(messages, 1)).toHaveLength(1);
  });
});
