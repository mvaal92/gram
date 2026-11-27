import type { GramUIMessage } from "@gram/contracts";
import { describe, expect, it } from "vitest";

import { activeTool, avatarState, excerpt, lastExchange, needsPerson } from "./companion-model";

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
    expect(lastExchange(messages)).toEqual({ asked: "second", reply: "new reply" });
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
