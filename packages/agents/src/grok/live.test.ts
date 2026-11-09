import { ThreadId } from "@gram/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@gram/contracts";
import { makeGrokHost } from "./session.ts";
import { grokAuthFact, grokSignInOf } from "./sign-in.ts";

const onPath = spawnSync("grok", ["--version"], { encoding: "utf8" }).status === 0;
const signIn = grokSignInOf(
  grokAuthFact(join(homedir(), ".grok", "auth.json")),
  (process.env["XAI_API_KEY"] ?? "") !== "",
);
const live = onPath && (signIn === "signedIn" || signIn === "apiKey");

const textOf = (events: ReadonlyArray<AgentEvent>): string =>
  events
    .flatMap((event) =>
      event.type === "chunk" && event.chunk.type === "text-delta" ? [event.chunk.delta] : [],
    )
    .join("");

describe("grok CLI smoke", () => {
  it.live.skipIf(!live)(
    "answers a one-word prompt",
    () =>
      Effect.gen(function* () {
        const dir = mkdtempSync(join(tmpdir(), "gram-grok-live-"));
        const work = join(dir, "work");
        mkdirSync(work);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
        );
        const events: AgentEvent[] = [];
        const host = yield* makeGrokHost({ dataDir: dir, maxTurns: 1 });
        const session = yield* host.open({
          threadId: ThreadId.make("live-1"),
          cwd: work,
          permissionMode: "plan",
          model: { agent: "grok", model: "grok-4.7" },
        });
        yield* session.events.pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              events.push(event);
            }),
          ),
          Stream.runDrain,
          Effect.forkScoped,
        );
        yield* session.send({
          text: "Reply with the single word pong. Do not use tools.",
        });
        yield* Effect.gen(function* () {
          for (let i = 0; i < 150; i++) {
            if (events.some((event) => event.type === "turnEnd")) return;
            yield* Effect.sleep("200 millis");
          }
          return yield* Effect.die("live grok turn did not end");
        });
        const end = events.find((event) => event.type === "turnEnd");
        expect(end).toMatchObject({ type: "turnEnd", reason: "completed" });
        expect(textOf(events).toLowerCase()).toContain("pong");
      }),
    40_000,
  );
});
