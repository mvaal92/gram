import type { PermissionMode, ReasoningVariant } from "@gram/contracts";
import type { OutwardGate } from "../host.ts";

/** Whether the next Grok process creates a session (`-s`) or continues one (`-r`). */
export type SessionPhase = "create" | "resume";

export interface GrokTurnArgs {
  readonly phase: SessionPhase;
  readonly sessionId: string;
  /** With a fork, the session `-r` reads before `--fork-session` creates `sessionId`. */
  readonly forkFrom?: string;
  readonly cwd: string;
  readonly promptFile: string;
  readonly model: string;
  readonly permissionMode: PermissionMode;
  readonly effort?: ReasoningVariant;
  /** Standing role text. `--rules` appends it to the system prompt on every turn. */
  readonly rules?: string;
  readonly additionalDirectories?: ReadonlyArray<string>;
  readonly outward?: OutwardGate;
  readonly maxTurns?: number;
  readonly disallowedTools?: ReadonlyArray<string>;
}

/**
 * Deny rules for Gram's outward gate. Grok matches these as command prefixes. A push made
 * another way is outside what a headless deny list can see.
 */
const DENY_ALL = [
  "Bash(git push)",
  "Bash(git merge)",
  "Bash(gh pr create)",
  "Bash(gh pr merge)",
  "Bash(gh pr close)",
  "Bash(gh pr comment)",
  "Bash(gh release)",
  "Bash(gh workflow)",
  "Bash(gh repo delete)",
];

const DENY_IRREVERSIBLE = [
  "Bash(git push --force)",
  "Bash(git push -f)",
  "Bash(git push --force-with-lease)",
  "Bash(git push --force-if-includes)",
  "Bash(git push --mirror)",
  "Bash(git push --delete)",
  "Bash(git push -d)",
  "Bash(gh pr merge)",
  "Bash(gh pr close)",
  "Bash(gh release)",
  "Bash(gh workflow)",
  "Bash(gh repo delete)",
];

/** `-s` creates a session. `-r` resumes one. A fork does both. */
export const sessionFlags = (
  args: Pick<GrokTurnArgs, "phase" | "sessionId" | "forkFrom">,
): ReadonlyArray<string> => {
  if (args.forkFrom !== undefined)
    return ["-r", args.forkFrom, "--fork-session", "-s", args.sessionId];
  return args.phase === "create" ? ["-s", args.sessionId] : ["-r", args.sessionId];
};

const repeat = (flag: string, values: ReadonlyArray<string>): string[] =>
  values.flatMap((value) => [flag, value]);

/**
 * Argv for one headless turn. `--add-dir` is only on a create: Grok rejects it with `-r`.
 * `acceptEdits` and `auto` also allow `Bash`, because a headless run cannot ask before a shell
 * command and would otherwise refuse tests. Deny rules still win.
 */
export const grokArgv = (args: GrokTurnArgs): ReadonlyArray<string> => {
  const allowBash = args.permissionMode === "acceptEdits" || args.permissionMode === "auto";
  const deny =
    args.outward === "all" ? DENY_ALL : args.outward === "irreversible" ? DENY_IRREVERSIBLE : [];
  const addDirs =
    args.phase === "create" && args.forkFrom === undefined
      ? (args.additionalDirectories ?? [])
      : [];
  const tools = (args.disallowedTools ?? []).filter((tool) => tool !== "");
  return [
    ...sessionFlags(args),
    "--prompt-file",
    args.promptFile,
    "--output-format",
    "streaming-json",
    "--cwd",
    args.cwd,
    "-m",
    args.model,
    "--permission-mode",
    args.permissionMode,
    "--verbatim",
    ...(args.effort === undefined ? [] : ["--reasoning-effort", args.effort]),
    ...(args.rules === undefined || args.rules === "" ? [] : ["--rules", args.rules]),
    ...(args.maxTurns === undefined ? [] : ["--max-turns", String(args.maxTurns)]),
    ...(tools.length === 0 ? [] : ["--disallowed-tools", tools.join(",")]),
    ...repeat("--add-dir", addDirs),
    ...(allowBash ? ["--allow", "Bash"] : []),
    ...repeat("--deny", deny),
  ];
};
