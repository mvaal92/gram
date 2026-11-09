import { describe, expect, it } from "vitest";
import { grokArgv, sessionFlags } from "./argv.ts";

const base = {
  cwd: "/work/repo",
  promptFile: "/tmp/prompt.txt",
  model: "grok-4.7",
  permissionMode: "default" as const,
  sessionId: "11111111-1111-4111-8111-111111111111",
};

describe("session flags", () => {
  it("creates with -s and resumes with -r", () => {
    expect(sessionFlags({ phase: "create", sessionId: base.sessionId })).toEqual([
      "-s",
      base.sessionId,
    ]);
    expect(sessionFlags({ phase: "resume", sessionId: base.sessionId })).toEqual([
      "-r",
      base.sessionId,
    ]);
  });

  it("forks by resuming the old id into a new one", () => {
    expect(
      sessionFlags({
        phase: "create",
        sessionId: base.sessionId,
        forkFrom: "22222222-2222-4222-8222-222222222222",
      }),
    ).toEqual([
      "-r",
      "22222222-2222-4222-8222-222222222222",
      "--fork-session",
      "-s",
      base.sessionId,
    ]);
  });
});

describe("grok argv", () => {
  it("keeps the prompt in a file and names the model on every turn", () => {
    const argv = grokArgv({ ...base, phase: "create" });
    expect(argv).toContain("--prompt-file");
    expect(argv).toContain("/tmp/prompt.txt");
    expect(argv).not.toContain("-p");
    expect(argv).toContain("-m");
    expect(argv).toContain("grok-4.7");
    expect(argv).toContain("--output-format");
    expect(argv).toContain("streaming-json");
  });

  it("allows Bash for acceptEdits and auto, and denies outward commands", () => {
    expect(grokArgv({ ...base, phase: "resume", permissionMode: "acceptEdits" })).toEqual(
      expect.arrayContaining(["--allow", "Bash"]),
    );
    expect(grokArgv({ ...base, phase: "resume", permissionMode: "plan" })).not.toContain("--allow");
    const gated = grokArgv({ ...base, phase: "resume", outward: "all" });
    expect(gated).toEqual(expect.arrayContaining(["--deny", "Bash(git push)"]));
    expect(gated).toEqual(expect.arrayContaining(["--deny", "Bash(gh pr create)"]));
    const irreversible = grokArgv({ ...base, phase: "resume", outward: "irreversible" });
    expect(irreversible).not.toContain("Bash(git push)");
    expect(irreversible).toEqual(expect.arrayContaining(["--deny", "Bash(git push --force)"]));
    expect(irreversible).toEqual(expect.arrayContaining(["--deny", "Bash(gh pr merge)"]));
  });

  it("adds directories only while creating", () => {
    expect(grokArgv({ ...base, phase: "create", additionalDirectories: ["/other"] })).toEqual(
      expect.arrayContaining(["--add-dir", "/other"]),
    );
    expect(grokArgv({ ...base, phase: "resume", additionalDirectories: ["/other"] })).not.toContain(
      "--add-dir",
    );
    expect(
      grokArgv({
        ...base,
        phase: "create",
        forkFrom: "22222222-2222-4222-8222-222222222222",
        additionalDirectories: ["/other"],
      }),
    ).not.toContain("--add-dir");
  });
});
