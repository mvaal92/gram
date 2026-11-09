#!/usr/bin/env node
/**
 * Invented Grok CLI for adapter tests. Records argv and whether secret env vars were
 * present. Never writes secret values.
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const scenario = process.env.GROK_FAKE_SCENARIO || "ok";
const home = process.env.GROK_HOME || "";

const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const promptFile = flag("--prompt-file");
let promptBytes = 0;
let promptMode = null;
if (promptFile !== undefined && fs.existsSync(promptFile)) {
  const stat = fs.statSync(promptFile);
  promptBytes = stat.size;
  promptMode = stat.mode & 0o777;
}

const record = {
  argv: args,
  scenario,
  hasApiKey: typeof process.env.XAI_API_KEY === "string" && process.env.XAI_API_KEY !== "",
  hasBearer: typeof process.env.GRAM_MCP_BEARER === "string" && process.env.GRAM_MCP_BEARER !== "",
  grokHome: home,
  authPath: process.env.GROK_AUTH_PATH || "",
  promptBytes,
  promptMode,
};

const log = process.env.GROK_FAKE_LOG;
if (log !== undefined && log !== "") {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, `${JSON.stringify(record)}\n`);
}

const session = flag("-s") || flag("-r") || "no-session";

const end = (text) => {
  process.stdout.write(`${JSON.stringify({ type: "text", data: text })}\n`);
  process.stdout.write(
    `${JSON.stringify({
      type: "usage",
      usage: {
        input_tokens: 4,
        output_tokens: 1,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 0,
        reasoning_tokens: 0,
      },
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      type: "end",
      stopReason: "end_turn",
      sessionId: session,
      usage: { input_tokens: 4, output_tokens: 1 },
      total_cost_usd: 0.01,
    })}\n`,
  );
  process.exit(0);
};

if (scenario === "fail-after-create") {
  if (args.includes("-s")) {
    const marker = path.join(home || ".", "created");
    if (home !== "") fs.mkdirSync(home, { recursive: true });
    if (fs.existsSync(marker)) process.exit(86);
    fs.writeFileSync(marker, "1");
    process.exit(1);
  }
  end("pong");
}

if (scenario === "cancel") {
  process.stdout.write(`${JSON.stringify({ type: "text", data: "working" })}\n`);
  setInterval(() => {}, 1_000);
} else if (scenario === "tool") {
  process.stdout.write(
    `${JSON.stringify({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "Bash",
      status: "running",
      rawInput: { command: "echo hi" },
    })}\n`,
  );
  process.stdout.write(
    `${JSON.stringify({
      type: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
      rawOutput: "hi",
    })}\n`,
  );
  end("done");
} else if (scenario === "permission") {
  process.stderr.write(
    "permission required: Bash(rm) was not run, as a headless run cannot ask for approval\n",
  );
  end("stopped");
} else if (scenario === "thought") {
  process.stdout.write(`${JSON.stringify({ type: "thought", data: "checking" })}\n`);
  end("pong");
} else {
  end("pong");
}
