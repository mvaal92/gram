import { createHash, randomBytes } from "node:crypto";
import {
  inferDeviceNameFromUserAgent,
  sanitizeDeviceName,
  sessionHash,
  sessionPublicId,
  type PairedDeviceSummary,
  type RemoteSession,
  type RemoteSessionStore,
} from "./remote-sessions.ts";
import { authTarget } from "./auth-target.ts";
import { makeLaunchToken, tokensEqual, type AuthDecision, type AuthRequest } from "./auth.ts";
import { DAY_MS } from "../zone-time.ts";

export const REMOTE_PAIR_PATH = "/remote/pair";
export const REMOTE_STATUS_PATH = "/remote/status";
export const REMOTE_RENAME_DEVICE_PATH = "/remote/devices/rename";
export const REMOTE_REVOKE_DEVICE_PATH = "/remote/devices/revoke";
export const REMOTE_DISCONNECT_PATH = "/remote/disconnect";
export const SESSION_LIFETIME_MS = 365 * DAY_MS;
export const REMOTE_CONNECT_PATH = "/remote/connect";
export const REMOTE_CLAIM_PATH = "/remote/claim";
export const PAIR_LIFETIME_MS = 15 * 60_000;
export const CLAIM_RATE_WINDOW_MS = 60_000;
export const CLAIM_MAX_FAILURES_PER_WINDOW = 8;
const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;

/** Deliberately one canonical HTTPS tailnet origin, never a wildcard or forwarded-header trust. */
export const remoteOrigin = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      value === url.origin &&
      url.protocol === "https:" &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(
        url.hostname,
      )
    )
      return value;
  } catch {
    /* Refuse malformed input without echoing it into logs. */
  }
  throw new Error("GRAM_REMOTE_ORIGIN must be one canonical HTTPS device.tailnet.ts.net origin");
};

export const remoteCookieName = (port: number): string => `__Host-gram_remote_${port}`;

// This bridge is deliberately self-contained. The fragment never goes to HTTP/proxy logs; clear
// it before any request, and exchange using same-origin POST. Do not add analytics or assets here.
const bridgeStyle = `body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:#0f1115;color:#e6e8ee;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Inter",sans-serif;-webkit-font-smoothing:antialiased}`;
const bridgeScript = `"use strict";
const secret = new URLSearchParams(location.hash.slice(1)).get("pair");
history.replaceState(null, "", location.pathname);
if (!secret) { document.body.textContent = "Open a fresh pairing link from your local Gram session."; }
else { document.body.textContent = "Connecting to Gram over your tailnet…"; fetch("${REMOTE_CLAIM_PATH}", { method: "POST", credentials: "same-origin", headers: { "content-type": "text/plain" }, body: secret }).then(response => {
if (response.ok) { location.replace("/"); }
else if (response.status === 429) { document.body.textContent = "Too many pairing attempts. Wait a minute, then open a fresh link."; }
else { document.body.textContent = "Pairing refused. Use a fresh link, or your existing paired session."; }
}).catch(() => { document.body.textContent = "Connection failed. Create a fresh pairing link locally."; }); }`;
export const pairingDocument = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gram pairing</title><style>${bridgeStyle}</style><body><script>${bridgeScript}</script></body>`;
export const pairingCsp = `default-src 'none'; style-src 'sha256-${createHash("sha256").update(bridgeStyle).digest("base64")}'; script-src 'sha256-${createHash("sha256").update(bridgeScript).digest("base64")}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`;

const LOCAL_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/mcp",
  REMOTE_PAIR_PATH,
  REMOTE_STATUS_PATH,
  REMOTE_RENAME_DEVICE_PATH,
  REMOTE_REVOKE_DEVICE_PATH,
]);

/** One ephemeral invitation and up to eight durable, expiring browser sessions. */
export const createRemoteAccess = (
  origin: string,
  port: number,
  now = Date.now,
  store?: RemoteSessionStore,
) => {
  remoteOrigin(origin);
  const host = new URL(origin).host;
  let invitation: { code: string; expiresAt: number } | undefined;
  let sessions: RemoteSession[] = store?.read() ?? [];
  let failedClaimTimestamps: number[] = [];
  let lastPersistedSeenAt = 0;

  const activeSessions = (currentNow = now()): RemoteSession[] =>
    sessions.filter((session) => currentNow < session.expiresAt);

  const findMatchingSession = (
    request: AuthRequest,
    currentNow = now(),
  ): RemoteSession | undefined => {
    const cookie = request.cookies[remoteCookieName(port)];
    if (cookie === undefined) return undefined;
    const targetHash = sessionHash(cookie);
    return sessions.find(
      (session) => currentNow < session.expiresAt && tokensEqual(targetHash, session.hash),
    );
  };

  const paired = (request: AuthRequest) => findMatchingSession(request) !== undefined;

  const isRateLimited = (currentNow = now()): boolean => {
    failedClaimTimestamps = failedClaimTimestamps.filter(
      (timestamp) => currentNow - timestamp < CLAIM_RATE_WINDOW_MS,
    );
    return failedClaimTimestamps.length >= CLAIM_MAX_FAILURES_PER_WINDOW;
  };

  const recordFailedClaim = (currentNow = now()) => {
    failedClaimTimestamps.push(currentNow);
  };

  return {
    origin,
    host,
    isRateLimited: () => isRateLimited(now()),
    mint: () => {
      const code = makeLaunchToken();
      invitation = { code, expiresAt: now() + PAIR_LIFETIME_MS };
      return {
        url: `${origin}${REMOTE_CONNECT_PATH}#pair=${code}`,
        expiresAt: invitation.expiresAt,
      };
    },
    /** Atomically consumes before issuing a session; wrong attempts don't consume an invitation. */
    claim: (request: AuthRequest, code: string): string | undefined => {
      const currentNow = now();
      const target = authTarget(request.url);
      if (
        target?.path !== REMOTE_CLAIM_PATH ||
        target.searchParams.has("boot") ||
        request.headers["host"] !== host ||
        request.headers["origin"] !== origin ||
        request.method !== "POST" ||
        paired(request) ||
        activeSessions(currentNow).length >= 8
      )
        return undefined;
      if (isRateLimited(currentNow)) return undefined;
      if (
        invitation === undefined ||
        currentNow >= invitation.expiresAt ||
        !tokensEqual(code, invitation.code)
      ) {
        recordFailedClaim(currentNow);
        return undefined;
      }
      invitation = undefined;
      const session = makeLaunchToken();
      const hash = sessionHash(session);
      const id = randomBytes(16).toString("hex");
      const name = sanitizeDeviceName(inferDeviceNameFromUserAgent(request.headers["user-agent"]));
      const next: RemoteSession[] = [
        ...activeSessions(currentNow),
        {
          id,
          hash,
          name,
          createdAt: currentNow,
          lastSeenAt: currentNow,
          expiresAt: currentNow + SESSION_LIFETIME_MS,
        },
      ];
      store?.write(next);
      sessions = next;
      return session;
    },
    /** Lists currently active paired devices (without hashes or bearer secrets). */
    listDevices: (): PairedDeviceSummary[] => {
      const currentNow = now();
      return activeSessions(currentNow).map((session, index) => {
        const createdFallback = Math.max(1, session.expiresAt - SESSION_LIFETIME_MS);
        const createdAt = session.createdAt ?? createdFallback;
        return {
          id: sessionPublicId(session),
          name: sanitizeDeviceName(session.name, `Phone ${index + 1}`),
          createdAt,
          lastSeenAt: session.lastSeenAt ?? createdAt,
          expiresAt: session.expiresAt,
        };
      });
    },
    /** Renames a paired device by its public `id`. */
    renameDevice: (id: string, rawName: string): boolean => {
      const currentNow = now();
      const trimmed = rawName.trim();
      if (trimmed === "") return false;
      const name = sanitizeDeviceName(trimmed);
      const active = activeSessions(currentNow);
      let found = false;
      const next = active.map((session) => {
        if (sessionPublicId(session) !== id) return session;
        found = true;
        return { ...session, id: sessionPublicId(session), name };
      });
      if (!found) return false;
      store?.write(next);
      sessions = next;
      return true;
    },
    /** Revokes a paired device by its public `id`, or all devices when `id === undefined`. */
    revokeDevice: (id?: string): boolean => {
      const currentNow = now();
      const active = activeSessions(currentNow);
      const next =
        id === undefined ? [] : active.filter((session) => sessionPublicId(session) !== id);
      if (id !== undefined && next.length === active.length) return false;
      store?.write(next);
      sessions = next;
      return true;
    },
    /** Revokes the caller's own remote session (`POST /remote/disconnect`). */
    disconnect: (request: AuthRequest): boolean => {
      const currentNow = now();
      const target = authTarget(request.url);
      if (
        target?.path !== REMOTE_DISCONNECT_PATH ||
        target.searchParams.has("boot") ||
        request.headers["host"] !== host ||
        request.headers["origin"] !== origin ||
        request.method !== "POST"
      )
        return false;
      const matched = findMatchingSession(request, currentNow);
      if (matched === undefined) return false;
      const next = activeSessions(currentNow).filter(
        (session) => !tokensEqual(session.hash, matched.hash),
      );
      store?.write(next);
      sessions = next;
      return true;
    },
    authorize: (request: AuthRequest): AuthDecision => {
      if (
        request.headers["host"] !== host ||
        (request.headers["origin"] !== undefined && request.headers["origin"] !== origin)
      )
        return { kind: "reject", status: 403, message: "forbidden: remote origin mismatch" };
      const target = authTarget(request.url);
      if (target === undefined)
        return { kind: "reject", status: 403, message: "forbidden: noncanonical request target" };
      if (target.path === "/ws" && request.headers["origin"] !== origin)
        return { kind: "reject", status: 403, message: "forbidden: WebSocket origin required" };
      if (LOCAL_ONLY_PATHS.has(target.path) || target.searchParams.has("boot"))
        return { kind: "reject", status: 403, message: "forbidden: local access only" };
      const currentNow = now();
      const matched = findMatchingSession(request, currentNow);
      if (matched === undefined) {
        return { kind: "reject", status: 401, message: "unauthorized: pair this browser locally" };
      }
      sessions = sessions.map((session) =>
        tokensEqual(session.hash, matched.hash) ? { ...session, lastSeenAt: currentNow } : session,
      );
      if (currentNow - lastPersistedSeenAt >= LAST_SEEN_PERSIST_INTERVAL_MS) {
        lastPersistedSeenAt = currentNow;
        try {
          store?.write(activeSessions(currentNow));
        } catch {
          // Best-effort timestamp flush; authorization itself already succeeded.
        }
      }
      return { kind: "pass" };
    },
  };
};
