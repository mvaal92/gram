import { ThreadId, type AgentEvent } from "@gram/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeGrokHost, type GrokHostConfig } from "./session.ts";

const fixture = fileURLToPath(new URL("../../fixtures/grok/cli.cjs", import.meta.url));
const SENTINEL_AUTH = "sentinel-auth-do-not-leak";
const SENTINEL_KEY = "sentinel-key-do-not-leak";
const SENTINEL_BEARER = "sentinel-bearer-do-not-leak";
const FROM = "22222222-2222-4222-8222-222222222222";
const INTO = "33333333-3333-4333-8333-333333333333";

interface Box {
  readonly dir: string;
  readonly binary: string;
  readonly log: string;
  readonly auth: string;
  readonly scenario: string;
}

const boxOf = (scenario: string): Box => {
  const dir = mkdtempSync(join(tmpdir(), "gram-grok-"));
  const binary = join(dir, "bin", "grok");
  mkdirSync(join(dir, "bin"));
  const log = join(dir, "log.ndjson");
  const auth = join(dir, "auth.json");
  writeFileSync(auth, `${SENTINEL_AUTH}\n`, { mode: 0o600 });
  writeFileSync(
    binary,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)} "$@"\n`,
  );
  chmodSync(binary, 0o755);
  return { dir, binary, log, auth, scenario };
};

const configOf = (box: Box, env: Record<string, string | undefined> = {}): GrokHostConfig => ({
  dataDir: box.dir,
  binary: box.binary,
  authPath: box.auth,
  env: { PATH: "/usr/bin", HOME: box.dir, XAI_API_KEY: SENTINEL_KEY, ...env },
  extraEnv: { GROK_FAKE_SCENARIO: box.scenario, GROK_FAKE_LOG: box.log },
});

interface Invocation {
  readonly argv: string[];
  readonly promptMode: number | null;
  readonly grokHome: string;
  readonly authPath: string;
  readonly hasApiKey: boolean;
  readonly hasBearer: boolean;
}

const invocations = (log: string): Invocation[] =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Invocation);

const deltas = (events: ReadonlyArray<AgentEvent>): string =>
  events
    .flatMap((event) =>
      event.type === "chunk" && event.chunk.type === "text-delta" ? [event.chunk.delta] : [],
    )
    .join("");

const watch = (events: AgentEvent[], sessionEvents: Stream.Stream<AgentEvent>) =>
  sessionEvents.pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    ),
    Stream.runDrain,
    Effect.forkScoped,
  );

const until = (pred: () => boolean) =>
  Effect.gen(function* () {
    for (let i = 0; i < 100; i++) {
      if (pred()) return;
      yield* Effect.sleep("20 millis");
    }
    return yield* Effect.die("timed out waiting for the grok turn");
  });

describe("GrokHost", () => {
  it.live("streams a turn, resumes with -r after -s, and keeps secrets out of the child", () =>
    Effect.gen(function* () {
      const box = boxOf("fail-after-create");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(box.dir, { recursive: true, force: true })),
      );
      const events: AgentEvent[] = [];
      const host = yield* makeGrokHost(configOf(box));
      const session = yield* host.open({
        threadId: ThreadId.make("thread-1"),
        cwd: box.dir,
        instructions: "follow the charter",
        permissionMode: "acceptEdits",
        outwardGate: "all",
        model: { agent: "grok", model: "grok-4.7", variant: "high" },
        mcp: {
          url: "http://127.0.0.1:9/mcp",
          headers: { authorization: `Bearer ${SENTINEL_BEARER}` },
        },
      });
      expect(events).toEqual([]);
      yield* watch(events, session.events);
      yield* until(() => events.some((event) => event.type === "identity"));
      expect(events[0]).toMatchObject({ type: "identity", model: "grok-4.7" });
      yield* session.send({ text: "hello from gram" });
      yield* until(() => events.filter((event) => event.type === "turnEnd").length >= 1);
      yield* session.send({ text: "hello again" });
      yield* until(() => events.filter((event) => event.type === "turnEnd").length >= 2);

      const [first, second] = invocations(box.log);
      expect(first?.argv).toContain("-s");
      expect(first?.argv).not.toContain("-r");
      expect(second?.argv).toContain("-r");
      expect(second?.argv).not.toContain("-s");
      expect(first?.argv).toEqual(expect.arrayContaining(["--rules", "follow the charter"]));
      expect(first?.argv).toEqual(expect.arrayContaining(["--reasoning-effort", "high"]));
      expect(first?.argv).toEqual(expect.arrayContaining(["--allow", "Bash"]));
      expect(first?.promptMode).toBe(0o600);
      expect(first?.argv.join("\0")).not.toContain("hello from gram");
      expect(first?.hasApiKey).toBe(true);
      expect(first?.hasBearer).toBe(true);
      expect(first?.authPath).toBe(box.auth);
      expect(first?.grokHome.startsWith(box.dir)).toBe(true);
      const config = readFileSync(join(first!.grokHome, "config.toml"), "utf8");
      expect(config).toContain('bearer_token_env_var = "GRAM_MCP_BEARER"');
      expect(config).toContain("http://127.0.0.1:9/mcp");
      const leaked = `${readFileSync(box.log, "utf8")}\n${config}`;
      expect(leaked).not.toContain(SENTINEL_AUTH);
      expect(leaked).not.toContain(SENTINEL_KEY);
      expect(leaked).not.toContain(SENTINEL_BEARER);
      expect(
        events.filter((event) => event.type === "turnEnd").map((event) => event.reason),
      ).toEqual(["error", "completed"]);
      expect(deltas(events)).toContain("pong");
    }),
  );

  it.live("interrupts a running turn", () =>
    Effect.gen(function* () {
      const box = boxOf("cancel");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(box.dir, { recursive: true, force: true })),
      );
      const events: AgentEvent[] = [];
      const host = yield* makeGrokHost({ ...configOf(box), interruptTimeoutMs: 2_000 });
      const session = yield* host.open({ threadId: ThreadId.make("thread-2"), cwd: box.dir });
      yield* watch(events, session.events);
      yield* session.send({ text: "wait" });
      yield* until(() => deltas(events).includes("working"));
      yield* session.interrupt;
      yield* until(() => events.some((event) => event.type === "turnEnd"));
      expect(events.find((event) => event.type === "turnEnd")).toMatchObject({
        reason: "interrupted",
      });
    }),
  );

  it.live("forks once with -s and then resumes the new id", () =>
    Effect.gen(function* () {
      const box = boxOf("ok");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(box.dir, { recursive: true, force: true })),
      );
      const events: AgentEvent[] = [];
      const host = yield* makeGrokHost(configOf(box));
      const session = yield* host.open({
        threadId: ThreadId.make("thread-3"),
        cwd: box.dir,
        resumeId: FROM,
        fork: true,
        sessionId: INTO,
      });
      yield* watch(events, session.events);
      yield* session.send({ text: "fork" });
      yield* until(() => events.some((event) => event.type === "turnEnd"));
      yield* session.send({ text: "next" });
      yield* until(() => events.filter((event) => event.type === "turnEnd").length >= 2);
      const [first, second] = invocations(box.log);
      expect(first?.argv).toEqual(
        expect.arrayContaining(["-r", FROM, "--fork-session", "-s", INTO]),
      );
      expect(second?.argv).toContain("-r");
      expect(second?.argv).toContain(INTO);
      expect(second?.argv).not.toContain("-s");
    }),
  );

  it.live("refuses a session when Grok is signed out, and does not spawn", () =>
    Effect.gen(function* () {
      const box = boxOf("ok");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(box.dir, { recursive: true, force: true })),
      );
      const missing = join(box.dir, "missing-auth.json");
      const host = yield* makeGrokHost(configOf(box, { XAI_API_KEY: undefined, HOME: box.dir }));
      const signedOut = yield* makeGrokHost({
        ...configOf(box, { XAI_API_KEY: undefined }),
        authPath: missing,
      });
      const result = yield* signedOut
        .open({ threadId: ThreadId.make("thread-4"), cwd: box.dir })
        .pipe(Effect.flip);
      expect(result.message).toContain("grok login");
      expect(existsSync(box.log)).toBe(false);
      expect(host).toBeDefined();
    }),
  );

  it.live("reports a tool the CLI already ran", () =>
    Effect.gen(function* () {
      const box = boxOf("tool");
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => rmSync(box.dir, { recursive: true, force: true })),
      );
      const events: AgentEvent[] = [];
      const host = yield* makeGrokHost(configOf(box));
      const session = yield* host.open({ threadId: ThreadId.make("thread-5"), cwd: box.dir });
      yield* watch(events, session.events);
      yield* session.send({ text: "run" });
      yield* until(() => events.some((event) => event.type === "turnEnd"));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "chunk",
          chunk: expect.objectContaining({
            type: "tool-input-available",
            toolName: "Bash",
            providerExecuted: true,
          }),
        }),
      );
    }),
  );
});
