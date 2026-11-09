import { statSync } from "node:fs";

import type { GrokSignIn } from "@gram/contracts";

/** What a stat of the auth file can say. The file is never opened. */
export type GrokAuthFact = "present" | "absent" | "unreadable";

/** `present` when the auth file exists and is non-empty. `ENOENT` is `absent`. */
export const grokAuthFact = (path: string): GrokAuthFact => {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0 ? "present" : "absent";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unreadable";
  }
};

/**
 * Session file wins over an API key. A key with no session file is `apiKey`. An unreadable
 * file with no key stays `unknown` so a launch check does not call the user signed out.
 */
export const grokSignInOf = (auth: GrokAuthFact, apiKeyConfigured: boolean): GrokSignIn => {
  if (auth === "present") return "signedIn";
  if (apiKeyConfigured) return "apiKey";
  if (auth === "absent") return "notSignedIn";
  return "unknown";
};
