import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The env var Grok's config names. The token itself is only in the child environment. */
export const GRAM_MCP_BEARER = "GRAM_MCP_BEARER";

const toml = (value: string): string => JSON.stringify(value);

/**
 * A per-thread Grok home whose config names Gram's HTTP MCP server. The bearer is an env var
 * name, never the token. An empty home still isolates sessions from the user's `~/.grok`.
 */
export const writeThreadHome = (dir: string, mcp: { readonly url: string } | undefined): void => {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lines = ["# Gram thread home."];
  if (mcp !== undefined) {
    lines.push(
      "",
      "[mcp_servers.gram]",
      `url = ${toml(mcp.url)}`,
      `bearer_token_env_var = ${toml(GRAM_MCP_BEARER)}`,
      "enabled = true",
    );
  }
  writeFileSync(join(dir, "config.toml"), `${lines.join("\n")}\n`, { mode: 0o600 });
};

/** The bearer token from Gram's MCP endpoint headers, without the `Bearer` prefix. */
export const bearerToken = (headers: Readonly<Record<string, string>>): string | undefined => {
  const raw = headers["authorization"] ?? headers["Authorization"];
  if (raw === undefined) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(raw.trim());
  return match?.[1];
};
