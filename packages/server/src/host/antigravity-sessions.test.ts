import { describe, expect, it } from "@effect/vitest";
import { AgentUnavailable, type ProfileId } from "@gram/contracts";
import * as Effect from "effect/Effect";
import {
  onMachineUnavailable,
  opensOnHost,
  opensOnMachine,
} from "../runtime/host-agent-sessions.ts";
import { HOST_FEATURES } from "./protocol.ts";
import { HOST_ANTIGRAVITY_MISSING } from "./session-gates.ts";
import { codexMachineWith, layer, THREAD } from "./sessions.testing.ts";

describe("a joined machine's Antigravity sessions", () => {
  it("open there, and a gateway profile's never does", () => {
    const plain = { threadId: THREAD, cwd: "/work" };
    expect(opensOnMachine("antigravity", plain)).toBe(true);
    expect(opensOnHost("antigravity", plain)).toBe(false);
    expect(
      opensOnMachine("antigravity", {
        ...plain,
        model: { agent: "antigravity", model: "gemini-4-neon", profileId: "p-1" as ProfileId },
      }),
    ).toBe(false);
  });

  it.live("start on the machine that runs them", () =>
    Effect.gen(function* () {
      const { onHost, inServer, agent } = yield* codexMachineWith(HOST_FEATURES, "antigravity");
      yield* agent.open({
        threadId: THREAD,
        cwd: "/work/repo",
        model: { agent: "antigravity", model: "gemini-4-neon" },
      });
      expect(inServer.opened).toEqual([]);
      expect(onHost.opened[0]).toMatchObject({
        model: { agent: "antigravity", model: "gemini-4-neon" },
      });
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.live("a host that doesn't run them is refused, saying why, and opens nothing", () =>
    Effect.gen(function* () {
      const { onHost, inServer, agent } = yield* codexMachineWith(
        HOST_FEATURES.filter((feature) => feature !== "agent-antigravity"),
        "antigravity",
      );
      const error = yield* agent
        .open({
          threadId: THREAD,
          cwd: "/work",
          model: { agent: "antigravity", model: "gemini-4-neon" },
        })
        .pipe(Effect.scoped, Effect.flip);
      expect(error).toMatchObject({ _tag: "AgentUnavailable", agent: "antigravity" });
      expect(error.message).toBe(`On box: ${HOST_ANTIGRAVITY_MISSING}`);
      expect(onHost.opened).toEqual([]);
      expect(inServer.opened).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it("names the right CLI when Antigravity or Grok Build isn't signed in on a joined machine", () => {
    expect(
      onMachineUnavailable(
        new AgentUnavailable({ agent: "antigravity", reason: "not-logged-in", message: "no auth" }),
        "box",
      ).message,
    ).toBe("Antigravity isn't signed in on box. Run `agy` there and sign in.");
    expect(
      onMachineUnavailable(
        new AgentUnavailable({ agent: "grok", reason: "not-logged-in", message: "no auth" }),
        "box",
      ).message,
    ).toBe("Grok Build isn't signed in on box. Run `grok login` there and sign in.");
  });
});
