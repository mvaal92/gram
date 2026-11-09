import type { AgentKind } from "@gram/contracts";

/**
 * Agents that may orchestrate and work. Mirrors `ADMITTED` in
 * `packages/server/src/orchestration/rules.ts` for those roles. Dreams use `DREAM_AGENTS`.
 */
export const ADMITTED_AGENTS: readonly AgentKind[] = ["claude", "codex", "grok"];

/** Agents a memory update may run on. Grok has no memory-update mode. */
export const DREAM_AGENTS: readonly AgentKind[] = ["claude", "codex"];
