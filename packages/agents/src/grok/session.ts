import {
  AgentUnavailable,
  AnswerUndelivered,
  InterruptHung,
  MessageId,
  type AgentCapabilities,
  type AgentEvent,
  type AgentModel,
  type ModelRef,
  type PermissionMode,
  type UserInput,
} from "@gram/contracts";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { pathCandidates } from "../cli/discovery.ts";
import { runCommand } from "../cli/process.ts";
import type { AgentHost, AgentSession, OpenSessionOptions } from "../host.ts";
import { gateLevel } from "../outward.ts";
import { grokArgv, type SessionPhase } from "./argv.ts";
import { grokChildEnv } from "./env.ts";
import { bearerToken, GRAM_MCP_BEARER, writeThreadHome } from "./mcp-config.ts";
import { BUILTIN_MODELS, GROK_DEFAULT_MODEL, parseGrokModels } from "./models.ts";
import { grokAuthFact, grokSignInOf } from "./sign-in.ts";
import { GrokTurn } from "./stream.ts";

/** The Grok CLI this adapter was written against. */
export const GROK_CLI_VERSION = "1.0.77";

const INTERRUPT_MS = 8_000;
const KILL_MS = 1_000;
const MODELS_TIMEOUT_MS = 20_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GROK_CAPABILITIES: AgentCapabilities = {
  fork: true,
  rewind: "none",
  steer: false,
  planMode: true,
  approvalScopes: [],
  userQuestions: false,
  costReporting: true,
  perTurnModel: true,
  reasoningEffort: true,
  listSessions: false,
  subagentStreams: false,
  stopTasks: false,
};

export interface GrokHostConfig {
  /** Gram's data directory. Each thread gets `grok/threads/<id>` as `GROK_HOME`. */
  readonly dataDir: string;
  /** Absolute path of the `grok` binary. Absent: the first `grok` on `PATH`. */
  readonly binary?: string;
  /** Auth file to stat and point `GROK_AUTH_PATH` at. Absent: `~/.grok/auth.json`. */
  readonly authPath?: string;
  /** Environment the child is filtered from. Absent: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Caps every turn. The live smoke test sets it; sessions leave it unset. */
  readonly maxTurns?: number;
  readonly disallowedTools?: ReadonlyArray<string>;
  readonly interruptTimeoutMs?: number;
  /** Extra child variables. `GROK_HOME` and the bearer still win. */
  readonly extraEnv?: Readonly<Record<string, string>>;
}

export class GrokHost extends Context.Service<GrokHost, AgentHost>()("@gram/agents/GrokHost") {}

const unavailable = (message: string) => new AgentUnavailable({ agent: "grok", message });

const parentEnv = (config: GrokHostConfig): Readonly<Record<string, string | undefined>> =>
  config.env ?? process.env;

const apiKeyConfigured = (env: Readonly<Record<string, string | undefined>>): boolean =>
  (env["XAI_API_KEY"] ?? "") !== "";

const findBinary = (config: GrokHostConfig): string | undefined => {
  if (config.binary !== undefined) return config.binary;
  const env = parentEnv(config);
  const path = env["PATH"] ?? env["Path"] ?? "";
  for (const candidate of pathCandidates({ PATH: path }, process.platform, "grok")) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
};

const posix = process.platform !== "win32";

const killGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  const pid = child.pid;
  if (pid === undefined) return;
  if (posix) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // The child already left the process group.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
};

const exited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const waitClose = (child: ChildProcess, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume, signal) => {
    if (exited(child)) {
      resume(Effect.succeed(true));
      return Effect.void;
    }
    const onClose = () => {
      clearTimeout(timer);
      resume(Effect.succeed(true));
    };
    const timer = setTimeout(() => {
      child.off("close", onClose);
      resume(Effect.succeed(false));
    }, timeoutMs);
    child.once("close", onClose);
    const stop = () => {
      clearTimeout(timer);
      child.off("close", onClose);
    };
    signal.addEventListener("abort", stop, { once: true });
    return Effect.sync(stop);
  });

const offer = (queue: Queue.Queue<AgentEvent>, events: ReadonlyArray<AgentEvent>): void => {
  for (const event of events) Effect.runSync(Queue.offer(queue, event).pipe(Effect.ignore));
};

const promptText = (input: UserInput): string => {
  const paths = (input.attachments ?? []).map((attachment) => attachment.path).filter(Boolean);
  return paths.length === 0 ? input.text : `${input.text}\n\n${paths.join("\n")}`;
};

const threadDir = (dataDir: string, threadId: string): string =>
  join(dataDir, "grok", "threads", threadId.replace(/[^A-Za-z0-9_-]/g, "_"));

/** The Grok CLI as an `AgentHost`. One process per turn. */
export const makeGrokHost = (config: GrokHostConfig): Effect.Effect<AgentHost> =>
  Effect.sync(() => {
    const authPath = config.authPath ?? join(homedir(), ".grok", "auth.json");
    const interruptTimeoutMs = config.interruptTimeoutMs ?? INTERRUPT_MS;

    const listModels = (): Effect.Effect<ReadonlyArray<AgentModel>, AgentUnavailable> =>
      Effect.gen(function* () {
        const binary = findBinary(config);
        if (binary === undefined) return BUILTIN_MODELS;
        const out = yield* runCommand(binary, ["models"], {
          env: grokChildEnv(parentEnv(config), {}),
          timeoutMs: MODELS_TIMEOUT_MS,
        }).pipe(Effect.orElseSucceed(() => ({ stdout: "", exitCode: 1 as number | null })));
        if (out.exitCode !== 0) return BUILTIN_MODELS;
        return parseGrokModels(out.stdout) ?? BUILTIN_MODELS;
      });

    const open = (
      options: OpenSessionOptions,
    ): Effect.Effect<AgentSession, AgentUnavailable, Scope.Scope> =>
      Effect.gen(function* () {
        if (
          options.dreamFilesOnly === true ||
          options.dreamGuided === true ||
          options.confineWrites === true
        )
          return yield* unavailable("Grok has no memory-update mode.");
        const binary = findBinary(config);
        if (binary === undefined)
          return yield* unavailable(
            "Grok isn't on PATH. Install it from https://x.ai/cli, then run `grok login`.",
          );
        const env = parentEnv(config);
        const signIn = grokSignInOf(grokAuthFact(authPath), apiKeyConfigured(env));
        if (signIn === "notSignedIn")
          return yield* unavailable(
            "Grok isn't signed in. Run `grok login`, or set XAI_API_KEY, then try again.",
          );
        if (options.resumeId !== undefined && !UUID_RE.test(options.resumeId))
          return yield* unavailable("Grok resumes sessions by UUID.");

        const forking = options.fork === true && options.resumeId !== undefined;
        let sessionId =
          options.resumeId !== undefined && !forking
            ? options.resumeId
            : options.sessionId !== undefined && UUID_RE.test(options.sessionId)
              ? options.sessionId
              : randomUUID();
        let phase: SessionPhase = options.resumeId !== undefined && !forking ? "resume" : "create";
        let forkFrom = forking ? options.resumeId : undefined;
        let model = options.model?.model ?? GROK_DEFAULT_MODEL;
        let effort = options.model?.variant;
        let mode: PermissionMode = options.permissionMode ?? "default";
        let child: ChildProcess | undefined;
        let busy = false;
        let killed = false;

        const home = threadDir(config.dataDir, options.threadId);
        const token = options.mcp === undefined ? undefined : bearerToken(options.mcp.headers);
        writeThreadHome(
          home,
          options.mcp !== undefined && token !== undefined ? { url: options.mcp.url } : undefined,
        );
        const childExtra: Record<string, string> = { ...config.extraEnv, GROK_HOME: home };
        if (grokAuthFact(authPath) === "present") childExtra["GROK_AUTH_PATH"] = authPath;
        if (token !== undefined) childExtra[GRAM_MCP_BEARER] = token;

        const queue = yield* Queue.unbounded<AgentEvent>();
        const scope = yield* Scope.Scope;
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (child !== undefined && !exited(child)) killGroup(child, "SIGTERM");
          }).pipe(Effect.andThen(Queue.shutdown(queue).pipe(Effect.ignore))),
        );
        yield* Queue.offerAll(queue, [
          {
            type: "identity",
            agentSessionId: sessionId,
            model,
            tools: [],
            commands: [],
          },
          { type: "status", status: "idle" },
        ]);

        const turn = (input: UserInput): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (busy) {
              offer(queue, [
                {
                  type: "notice",
                  level: "info",
                  message: "Grok is still on the previous turn.",
                },
              ]);
              return;
            }
            busy = true;
            killed = false;
            const messageId = MessageId.make(randomUUID());
            const promptFile = join(home, "prompt.txt");
            const creating = phase === "create" && forkFrom === undefined;
            const outward = gateLevel(options.outwardGate);
            const args = grokArgv({
              phase,
              sessionId,
              ...(forkFrom === undefined ? {} : { forkFrom }),
              cwd: options.cwd,
              promptFile,
              model,
              permissionMode: mode,
              ...(effort === undefined ? {} : { effort }),
              ...(options.instructions === undefined || options.instructions === ""
                ? {}
                : { rules: options.instructions }),
              ...(options.additionalDirectories === undefined
                ? {}
                : { additionalDirectories: options.additionalDirectories }),
              ...(outward === undefined ? {} : { outward }),
              ...(config.maxTurns === undefined ? {} : { maxTurns: config.maxTurns }),
              ...(config.disallowedTools === undefined
                ? {}
                : { disallowedTools: config.disallowedTools }),
            });
            yield* Effect.sync(() => {
              writeFileSync(promptFile, promptText(input), { mode: 0o600 });
              chmodSync(promptFile, 0o600);
            });
            const mapper = new GrokTurn(messageId);
            yield* Queue.offerAll(queue, [
              { type: "status", status: "running" },
              {
                type: "chunk",
                messageId,
                chunk: {
                  type: "start",
                  messageId,
                  messageMetadata: { agentMessageIds: [messageId] },
                },
              },
            ]);

            yield* Effect.callback<void>((resume, signal) => {
              let stderr = "";
              let settled = false;
              const proc = spawn(binary, [...args], {
                cwd: options.cwd,
                env: grokChildEnv(env, childExtra),
                detached: posix,
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
              });
              child = proc;
              if (proc.pid !== undefined && (creating || forkFrom !== undefined)) {
                phase = "resume";
                forkFrom = undefined;
              }
              let buffer = "";
              proc.stdout?.setEncoding("utf8");
              proc.stdout?.on("data", (chunk: string) => {
                buffer += chunk;
                let nl = buffer.indexOf("\n");
                while (nl !== -1) {
                  const line = buffer.slice(0, nl);
                  buffer = buffer.slice(nl + 1);
                  offer(queue, mapper.push(line));
                  nl = buffer.indexOf("\n");
                }
                if (buffer.length > 1_000_000) buffer = "";
              });
              proc.stderr?.setEncoding("utf8");
              proc.stderr?.on("data", (chunk: string) => {
                if (stderr.length < 4_096) stderr += chunk;
              });
              const finish = (code: number | null) => {
                if (settled) return;
                settled = true;
                if (buffer.trim() !== "") offer(queue, mapper.push(buffer));
                buffer = "";
                const permissionDenied = /permission required|headless run cannot ask/i.test(
                  stderr,
                );
                stderr = "";
                offer(queue, mapper.finish({ code, killed, permissionDenied }));
                try {
                  unlinkSync(promptFile);
                } catch {
                  // The prompt file is already gone.
                }
                busy = false;
                if (child === proc) child = undefined;
                resume(Effect.void);
              };
              proc.on("error", () => finish(null));
              proc.on("close", (code) => finish(code));
              signal.addEventListener(
                "abort",
                () => {
                  killed = true;
                  killGroup(proc, "SIGTERM");
                },
                { once: true },
              );
              return Effect.sync(() => {
                killed = true;
                killGroup(proc, "SIGTERM");
              });
            });
          });

        const session: AgentSession = {
          events: Stream.fromQueue(queue),
          send: (input) => turn(input).pipe(Effect.forkIn(scope), Effect.asVoid),
          steer: () => Effect.void,
          interrupt: Effect.gen(function* () {
            const current = child;
            if (current === undefined || exited(current)) return;
            killed = true;
            killGroup(current, "SIGTERM");
            if (yield* waitClose(current, interruptTimeoutMs)) return;
            killGroup(current, "SIGKILL");
            if (!(yield* waitClose(current, KILL_MS)))
              return yield* new InterruptHung({ timeoutMs: interruptTimeoutMs });
          }),
          respond: () =>
            Effect.fail(
              new AnswerUndelivered({
                message: "Grok doesn't take answers in a headless turn.",
              }),
            ),
          setMode: (next) =>
            Effect.sync(() => {
              mode = next;
            }),
          setModel: (next: ModelRef) =>
            Effect.sync(() => {
              model = next.model;
              effort = next.variant;
            }),
          processId: Effect.sync(() => child?.pid),
        };
        return session;
      });

    return {
      kind: "grok",
      capabilities: GROK_CAPABILITIES,
      open,
      listModels,
    } satisfies AgentHost;
  });

export const GrokHostLive = (config: GrokHostConfig): Layer.Layer<GrokHost> =>
  Layer.effect(GrokHost, makeGrokHost(config));
