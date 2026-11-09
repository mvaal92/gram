const ALLOW = new Set([
  "HOME",
  "USER",
  "LOGNAME",
  "USERPROFILE",
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",
  "all_proxy",
]);

/**
 * The child environment: a short allowlist, `XAI_API_KEY` when it is already set, and Gram's
 * `GROK_*` overrides. `GROK_DISABLE_AUTOUPDATER` replaces a flag this CLI version does not have.
 */
export const grokChildEnv = (
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>,
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined || value === "") continue;
    if (ALLOW.has(key) || key.startsWith("XDG_")) env[key] = value;
  }
  const apiKey = parent["XAI_API_KEY"];
  if (apiKey !== undefined && apiKey !== "") env["XAI_API_KEY"] = apiKey;
  env["GROK_DISABLE_AUTOUPDATER"] = "1";
  for (const [key, value] of Object.entries(extra)) {
    if (value !== "") env[key] = value;
  }
  return env;
};
