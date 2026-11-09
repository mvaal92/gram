import { MessageId, type AgentEvent } from "@gram/contracts";
import { describe, expect, it } from "vitest";
import { GrokTurn } from "./stream.ts";

const text = (events: ReadonlyArray<AgentEvent>): string =>
  events
    .flatMap((event) =>
      event.type === "chunk" && event.chunk.type === "text-delta" ? [event.chunk.delta] : [],
    )
    .join("");

const turn = () => new GrokTurn(MessageId.make("msg-1"));

describe("Grok streaming JSON", () => {
  it("maps text, usage and the end record onto one turn", () => {
    const mapper = turn();
    const events = [
      ...mapper.push('{"type":"text","data":"pon"}'),
      ...mapper.push("not json"),
      ...mapper.push('{"type":"text","data":"g"}'),
      ...mapper.push(
        '{"type":"usage","usage":{"input_tokens":4,"output_tokens":1,"cache_read_input_tokens":2,"reasoning_tokens":0}}',
      ),
      ...mapper.push(
        '{"type":"end","stopReason":"end_turn","usage":{"input_tokens":4,"output_tokens":1},"total_cost_usd":0.01}',
      ),
      ...mapper.finish({ code: 0, killed: false, permissionDenied: false }),
    ];
    expect(text(events)).toBe("pong");
    expect(events.some((event) => event.type === "chunk" && event.chunk.type === "text-end")).toBe(
      true,
    );
    expect(events).toContainEqual({
      type: "usage",
      tokens: { inputTokens: 4, outputTokens: 1, cacheReadTokens: 2, reasoningTokens: 0 },
      costUsd: 0.01,
    });
    expect(events).toContainEqual({ type: "turnEnd", reason: "completed" });
  });

  it("closes text before a provider-executed tool call", () => {
    const mapper = turn();
    const events = [
      ...mapper.push('{"type":"text","data":"hi"}'),
      ...mapper.push(
        '{"type":"tool_call","toolCallId":"call-1","toolName":"Bash","rawInput":{"command":"echo hi"}}',
      ),
      ...mapper.push(
        '{"type":"tool_call_update","toolCallId":"call-1","status":"completed","rawOutput":"hi"}',
      ),
      ...mapper.finish({ code: 0, killed: false, permissionDenied: false }),
    ];
    const types = events.flatMap((event) =>
      event.type === "chunk" ? [event.chunk.type] : [event.type],
    );
    expect(types.indexOf("text-end")).toBeLessThan(types.indexOf("tool-input-start"));
    expect(events).toContainEqual({
      type: "chunk",
      messageId: MessageId.make("msg-1"),
      chunk: {
        type: "tool-input-available",
        toolCallId: "call-1",
        toolName: "Bash",
        input: { command: "echo hi" },
        providerExecuted: true,
      },
    });
  });

  it("omits a cost when the report is partial, and treats a kill as interrupted", () => {
    const mapper = turn();
    mapper.push(
      '{"type":"end","stopReason":"end_turn","usage":{"input_tokens":1,"output_tokens":1},"total_cost_usd":1,"usage_is_incomplete":true}',
    );
    const events = mapper.finish({ code: null, killed: true, permissionDenied: false });
    const usage = events.find((event) => event.type === "usage");
    expect(usage).toMatchObject({ partial: true, tokens: { inputTokens: 1, outputTokens: 1 } });
    expect(usage).not.toHaveProperty("costUsd");
    expect(events).toContainEqual({ type: "turnEnd", reason: "interrupted" });
  });

  it("says when a headless run refused a tool", () => {
    const events = turn().finish({ code: 0, killed: false, permissionDenied: true });
    expect(events).toContainEqual({
      type: "notice",
      level: "warning",
      message: "Grok refused a tool because a headless run cannot ask for approval.",
    });
  });
});
