import type { AgentEvent, MessageId, TokenUsage, TurnEndReason } from "@gram/contracts";

export interface TurnExit {
  readonly code: number | null;
  readonly killed: boolean;
  readonly permissionDenied: boolean;
}

interface UsageBody {
  readonly tokens?: TokenUsage;
  readonly partial: boolean;
  readonly costUsd?: number;
}

const nat = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value);
};

const tokensOf = (usage: unknown): TokenUsage | undefined => {
  if (typeof usage !== "object" || usage === null) return undefined;
  const body = usage as Record<string, unknown>;
  const inputTokens = nat(body["input_tokens"]);
  const outputTokens = nat(body["output_tokens"]);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const cacheReadTokens = nat(body["cache_read_input_tokens"]);
  const cacheWriteTokens = nat(body["cache_creation_input_tokens"]);
  const reasoningTokens = nat(body["reasoning_tokens"]);
  return {
    inputTokens,
    outputTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  };
};

const usageOf = (record: Record<string, unknown>): UsageBody | undefined => {
  const tokens = tokensOf(record["usage"]);
  const partial = record["usage_is_incomplete"] === true || record["cost_is_partial"] === true;
  const cost = record["total_cost_usd"];
  const costUsd =
    typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && !partial ? cost : undefined;
  if (tokens === undefined && costUsd === undefined && !partial) return undefined;
  return {
    ...(tokens === undefined ? {} : { tokens }),
    partial,
    ...(costUsd === undefined ? {} : { costUsd }),
  };
};

const reasonOf = (stop: unknown): { readonly reason: TurnEndReason; readonly error?: string } => {
  switch (stop) {
    case "end_turn":
    case "stop":
    case "end":
      return { reason: "completed" };
    case "max_tokens":
    case "max_turns":
      return { reason: "maxTurns" };
    case "cancelled":
    case "canceled":
    case "interrupted":
      return { reason: "interrupted" };
    default:
      return {
        reason: "error",
        error:
          typeof stop === "string" && stop !== "" ? `Grok stopped (${stop}).` : "Grok stopped.",
      };
  }
};

/** One turn's NDJSON. Non-JSON lines are ignored. Tool calls are provider-executed. */
export class GrokTurn {
  private text: string | undefined;
  private thought: string | undefined;
  private seq = 0;
  private terminal = false;
  private ending: { readonly reason: TurnEndReason; readonly error?: string } | undefined;
  private usage: UsageBody | undefined;

  private readonly messageId: MessageId;

  constructor(messageId: MessageId) {
    this.messageId = messageId;
  }

  push(line: string): AgentEvent[] {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed[0] !== "{") return [];
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) return [];
      record = parsed as Record<string, unknown>;
    } catch {
      return [];
    }
    const events: AgentEvent[] = [];
    const type = record["type"];
    if (type === "text" || type === "thought") {
      const data = record["data"];
      if (typeof data !== "string" || data === "") return events;
      if (type === "text") this.delta(events, "text", data);
      else this.delta(events, "thought", data);
      return events;
    }
    if (type === "tool_call") {
      this.closeStreams(events);
      const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
      const toolName = typeof record["toolName"] === "string" ? record["toolName"] : "tool";
      if (toolCallId === "") return events;
      const input = record["rawInput"] === undefined ? {} : record["rawInput"];
      events.push({
        type: "chunk",
        messageId: this.messageId,
        chunk: { type: "tool-input-start", toolCallId, toolName },
      });
      events.push({
        type: "chunk",
        messageId: this.messageId,
        chunk: {
          type: "tool-input-available",
          toolCallId,
          toolName,
          input,
          providerExecuted: true,
        },
      });
      return events;
    }
    if (type === "tool_call_update") {
      this.closeStreams(events);
      const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
      if (toolCallId === "") return events;
      events.push({
        type: "chunk",
        messageId: this.messageId,
        chunk: {
          type: "tool-output-available",
          toolCallId,
          output:
            record["rawOutput"] === undefined ? { status: record["status"] } : record["rawOutput"],
          providerExecuted: true,
        },
      });
      return events;
    }
    if (type === "usage" || type === "end") {
      const next = usageOf(record);
      if (next !== undefined) {
        const partial = (this.usage?.partial ?? false) || next.partial;
        const tokens =
          next.tokens === undefined
            ? this.usage?.tokens
            : { ...this.usage?.tokens, ...next.tokens };
        const costUsd = partial ? undefined : (next.costUsd ?? this.usage?.costUsd);
        this.usage = {
          ...(tokens === undefined ? {} : { tokens }),
          partial,
          ...(costUsd === undefined ? {} : { costUsd }),
        };
      }
      if (type === "end") this.ending = reasonOf(record["stopReason"]);
    }
    return events;
  }

  finish(exit: TurnExit): AgentEvent[] {
    if (this.terminal) return [];
    this.terminal = true;
    const events: AgentEvent[] = [];
    this.closeStreams(events);
    events.push({ type: "chunk", messageId: this.messageId, chunk: { type: "finish" } });
    if (this.usage?.tokens !== undefined) {
      events.push({
        type: "usage",
        tokens: this.usage.tokens,
        ...(this.usage.partial ? { partial: true } : {}),
        ...(this.usage.costUsd === undefined ? {} : { costUsd: this.usage.costUsd }),
      });
    }
    if (exit.permissionDenied) {
      events.push({
        type: "notice",
        level: "warning",
        message: "Grok refused a tool because a headless run cannot ask for approval.",
      });
    }
    const ending = exit.killed
      ? { reason: "interrupted" as const }
      : (this.ending ??
        (exit.code === 0
          ? { reason: "error" as const, error: "Grok ended the turn without a result." }
          : {
              reason: "error" as const,
              error: `Grok exited with status ${exit.code ?? "unknown"}.`,
            }));
    events.push({
      type: "turnEnd",
      reason: ending.reason,
      ...(ending.error === undefined ? {} : { error: ending.error }),
    });
    events.push({ type: "status", status: "idle" });
    return events;
  }

  private delta(events: AgentEvent[], kind: "text" | "thought", data: string): void {
    const other = kind === "text" ? "thought" : "text";
    this.end(events, other);
    const current = kind === "text" ? this.text : this.thought;
    const id = current ?? `${kind}-${this.seq++}`;
    if (current === undefined) {
      if (kind === "text") this.text = id;
      else this.thought = id;
      events.push({
        type: "chunk",
        messageId: this.messageId,
        chunk: kind === "text" ? { type: "text-start", id } : { type: "reasoning-start", id },
      });
    }
    events.push({
      type: "chunk",
      messageId: this.messageId,
      chunk:
        kind === "text"
          ? { type: "text-delta", id, delta: data }
          : { type: "reasoning-delta", id, delta: data },
    });
  }

  private end(events: AgentEvent[], kind: "text" | "thought"): void {
    const id = kind === "text" ? this.text : this.thought;
    if (id === undefined) return;
    if (kind === "text") this.text = undefined;
    else this.thought = undefined;
    events.push({
      type: "chunk",
      messageId: this.messageId,
      chunk: kind === "text" ? { type: "text-end", id } : { type: "reasoning-end", id },
    });
  }

  private closeStreams(events: AgentEvent[]): void {
    this.end(events, "text");
    this.end(events, "thought");
  }
}
