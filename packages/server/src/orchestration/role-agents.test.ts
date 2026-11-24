import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_SETTINGS, type PermissionMode } from "@gram/contracts";
import { roleAgentsFrom } from "./role-agents.ts";
import { browserFor, closestWorkerModel, kindName } from "./rules.ts";
import { gateHoldsIn } from "./service/kit.ts";

describe("roleAgentsFrom", () => {
  it("lets a deployment add Grok Build and Antigravity to the roles, and nothing else", () => {
    expect(roleAgentsFrom("grok")).toEqual(["grok"]);
    expect(roleAgentsFrom("antigravity, grok")).toEqual(["grok", "antigravity"]);
    expect(roleAgentsFrom(" Grok , opencode")).toEqual(["grok"]);
    expect(roleAgentsFrom("opencode,claude")).toEqual([]);
    expect(roleAgentsFrom(undefined)).toEqual([]);
  });
});

describe("gateHoldsIn", () => {
  const modes: ReadonlyArray<PermissionMode> = [
    "default",
    "acceptEdits",
    "plan",
    "auto",
    "dontAsk",
    "bypassPermissions",
  ];

  it("holds in every mode for Claude, Grok Build and Antigravity, outside dontAsk for Codex, and never for OpenCode", () => {
    for (const mode of modes) {
      expect(gateHoldsIn("claude", mode)).toBe(true);
      expect(gateHoldsIn("grok", mode)).toBe(true);
      expect(gateHoldsIn("antigravity", mode)).toBe(true);
      expect(gateHoldsIn("codex", mode)).toBe(mode !== "dontAsk");
      expect(gateHoldsIn("opencode", mode)).toBe(false);
    }
  });
});

describe("multi-agent orchestration rules", () => {
  it("resolves prefixed typos and prose names for Antigravity and Grok Build", () => {
    expect(
      closestWorkerModel(
        [
          { agent: "antigravity", model: "gemini-4-neon" },
          { agent: "grok", model: "grok-4.7" },
        ],
        "antigravity:gemini-4-neo",
      ),
    ).toBe("antigravity:gemini-4-neon");
    expect(closestWorkerModel([{ agent: "grok", model: "grok-4.7" }], "grok:grok-4.6")).toBe(
      "grok:grok-4.7",
    );
    expect(kindName("claude")).toBe("Claude");
    expect(kindName("antigravity")).toBe("Antigravity");
    expect(kindName("grok")).toBe("Grok Build");
  });

  it("never enables user browser automation for Antigravity, Grok Build or OpenCode", () => {
    const bothConsented = {
      ...DEFAULT_SETTINGS,
      agents: { ...DEFAULT_SETTINGS.agents, claudeInChrome: true, codexComputerUse: true },
      workspaces: { orchestratorBrowser: true, workerBrowser: true },
    };
    for (const agent of ["antigravity", "grok", "opencode"] as const) {
      expect(
        browserFor(
          { model: { agent, model: "m" }, role: "orchestrator", browser: true },
          "orchestrator",
          bothConsented,
        ),
      ).toBe(false);
      expect(
        browserFor({ model: { agent, model: "m" }, browser: true }, "plain", bothConsented),
      ).toBe(false);
    }
  });
});
