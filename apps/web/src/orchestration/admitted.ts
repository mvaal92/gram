import type { AgentKind } from "@gram/contracts";
import { useMemo, useSyncExternalStore } from "react";

import { useApi } from "@/api/context";
import { useEmbedShell } from "@/embed/store";

/**
 * The agent kinds that may orchestrate and work. Mirrors the server's `ADMITTED` in
 * `packages/server/src/orchestration/rules.ts`, which is the authority: a pick outside it is
 * refused there. Kept here, and only here, so the pickers don't offer what would be refused.
 */
export const ADMITTED_AGENTS: readonly AgentKind[] = ["claude", "codex"];

/** `ADMITTED_AGENTS` with optional role agents admitted by the server or an embedding shell. */
export const admittedAgents = (roleAgents: readonly AgentKind[]): readonly AgentKind[] => {
  const extra = roleAgents.filter((agent) => !ADMITTED_AGENTS.includes(agent));
  return extra.length === 0 ? ADMITTED_AGENTS : [...ADMITTED_AGENTS, ...new Set(extra)];
};

const NOOP_SUBSCRIBE = () => () => undefined;
const EMPTY_ROLE_AGENTS: readonly AgentKind[] = [];

/** The agents the pickers offer for the orchestrator and worker roles here. */
export const useAdmittedAgents = (): readonly AgentKind[] => {
  const embed = useEmbedShell((s) => s.roleAgents);
  const { served } = useApi();
  const server = useSyncExternalStore(
    served?.subscribe ?? NOOP_SUBSCRIBE,
    () => served?.roleAgents ?? EMPTY_ROLE_AGENTS,
  );
  return useMemo(() => admittedAgents([...embed, ...server]), [embed, server]);
};
