import { describe, expect, it } from "vitest";
import {
  createRemoteAccess,
  PAIR_LIFETIME_MS,
  remoteCookieName,
  remoteOrigin,
  pairingDocument,
  pairingCsp,
} from "./remote-access.ts";
import { authorize, type AuthRequest } from "./auth.ts";

const ORIGIN = "https://device.tail123.ts.net:9443";
const HOST = new URL(ORIGIN).host;
const PORT = 4321;
const request = (overrides: Partial<AuthRequest> = {}): AuthRequest => ({
  method: "GET",
  url: "/",
  headers: { host: HOST, origin: ORIGIN },
  cookies: {},
  ...overrides,
});
const codeOf = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get("pair")!;
const claim = (
  access: ReturnType<typeof createRemoteAccess>,
  code: string,
  overrides: Partial<AuthRequest> = {},
) => access.claim(request({ method: "POST", url: "/remote/claim", ...overrides }), code);

describe("private browser access", () => {
  it("has a meaningful before/after: loopback auth refuses the configured remote, which still needs pairing", () => {
    expect(authorize({ port: PORT, token: "synthetic-local" }, request())).toMatchObject({
      status: 403,
    });
    const access = createRemoteAccess(ORIGIN, PORT);
    expect(access.authorize(request())).toMatchObject({ status: 401 });
    const session = claim(access, codeOf(access.mint().url))!;
    expect(session).toMatch(/^[a-f0-9]{64}$/);
    expect(access.authorize(request({ cookies: { [remoteCookieName(PORT)]: session } }))).toEqual({
      kind: "pass",
    });
  });

  it("requires canonical HTTPS device tailnet origins, fails closed on malformed opt-in", () => {
    expect(remoteOrigin(undefined)).toBeUndefined();
    expect(remoteOrigin(ORIGIN)).toBe(ORIGIN);
    for (const origin of [
      "",
      "http://device.tail123.ts.net",
      "https://device.tail123.ts.net/",
      "https://device.tail123.ts.net:443",
      "https://DEVICE.tail123.ts.net",
      "https://user:secret@device.tail123.ts.net",
      "https://*.tail123.ts.net",
      "https://device.tail123.ts.net/path",
      "https://device.tail123.ts.net?x=1",
      "https://device.tail123.ts.net#x",
      "https://device.tail123.ts.net.attacker.invalid",
      "https://127.0.0.1",
      "https://ts.net",
    ]) {
      expect(() => remoteOrigin(origin)).toThrow("GRAM_REMOTE_ORIGIN");
    }
  });

  it("expires at 15 minutes, replaces old invitations and consumes once synchronously", async () => {
    let now = 1000;
    const access = createRemoteAccess(ORIGIN, PORT, () => now);
    const old = codeOf(access.mint().url);
    const next = access.mint();
    expect(next.expiresAt).toBe(now + PAIR_LIFETIME_MS);
    expect(claim(access, old)).toBeUndefined();
    expect(claim(access, "wrong")).toBeUndefined();
    const results = await Promise.all([0, 1].map(async () => claim(access, codeOf(next.url))));
    expect(results.filter(Boolean)).toHaveLength(1);
    const expired = codeOf(access.mint().url);
    now += PAIR_LIFETIME_MS;
    expect(claim(access, expired)).toBeUndefined();
  });

  it("requires POST and exact Origin, refuses session swapping without burning the invitation", () => {
    const access = createRemoteAccess(ORIGIN, PORT);
    const code = codeOf(access.mint().url);
    for (const headers of [
      { host: HOST },
      { host: HOST, origin: "null" },
      { host: HOST, origin: "https://evil.invalid" },
      {
        host: "evil.invalid",
        origin: ORIGIN,
        "x-forwarded-host": HOST,
        "x-forwarded-proto": "https",
      },
    ]) {
      expect(claim(access, code, { headers })).toBeUndefined();
    }
    expect(claim(access, code, { method: "GET" })).toBeUndefined();
    const session = claim(access, code)!;
    const next = codeOf(access.mint().url);
    expect(claim(access, next, { cookies: { [remoteCookieName(PORT)]: session } })).toBeUndefined();
    expect(claim(access, next)).toBeTruthy();
  });

  it("separates local and remote cookies, refuses remote boot/MCP/mint, foreign WS origin and forwarded spoofing", () => {
    const access = createRemoteAccess(ORIGIN, PORT);
    const session = claim(access, codeOf(access.mint().url))!;
    const cookies = { [remoteCookieName(PORT)]: session };
    expect(
      access.authorize(request({ cookies: { sb_token_4321: "synthetic-local" } })),
    ).toMatchObject({ status: 401 });
    expect(
      authorize(
        { port: PORT, token: "synthetic-local" },
        request({ headers: { host: `127.0.0.1:${PORT}` }, cookies }),
      ),
    ).toMatchObject({ status: 401 });
    for (const url of ["/mcp", "/remote/pair", "/?boot=synthetic-local"])
      expect(access.authorize(request({ url, cookies }))).toMatchObject({ status: 403 });
    expect(access.authorize(request({ url: "/ws", cookies }))).toEqual({ kind: "pass" });
    expect(
      access.authorize(
        request({ url: "/ws", cookies, headers: { host: HOST, origin: "https://evil.invalid" } }),
      ),
    ).toMatchObject({ status: 403 });
    expect(
      access.authorize(
        request({
          cookies,
          headers: {
            host: "evil.invalid",
            "x-forwarded-host": HOST,
            "x-forwarded-proto": "https",
            origin: ORIGIN,
          },
        }),
      ),
    ).toMatchObject({ status: 403 });
    expect(createRemoteAccess(ORIGIN, PORT).authorize(request({ cookies }))).toMatchObject({
      status: 401,
    });
  });

  it("bounds browser sessions without silently evicting authenticated browsers", () => {
    const access = createRemoteAccess(ORIGIN, PORT);
    const sessions = Array.from({ length: 8 }, () => claim(access, codeOf(access.mint().url))!);
    expect(sessions.every(Boolean)).toBe(true);
    expect(claim(access, codeOf(access.mint().url))).toBeUndefined();
    for (const session of sessions) {
      expect(access.authorize(request({ cookies: { [remoteCookieName(PORT)]: session } }))).toEqual(
        { kind: "pass" },
      );
    }
    expect(
      access.authorize(
        request({
          url: "/ws",
          headers: { host: HOST },
          cookies: { [remoteCookieName(PORT)]: sessions[0] },
        }),
      ),
    ).toMatchObject({ status: 403 });
  });

  it("keeps the invitation in the fragment and clears browser history before any network exchange", () => {
    const link = new URL(createRemoteAccess(ORIGIN, PORT).mint().url);
    expect(link.search).toBe("");
    expect(link.hash).toMatch(/^#pair=[a-f0-9]{64}$/);
    expect(pairingDocument.indexOf("history.replaceState")).toBeLessThan(
      pairingDocument.indexOf("fetch("),
    );
    expect(pairingDocument).not.toContain("src=");
    expect(pairingCsp).toContain("script-src 'sha256-");
  });

  it("rate-limits repeated failed claim attempts without burning a valid invitation once the window passes", () => {
    let now = 10_000;
    const access = createRemoteAccess(ORIGIN, PORT, () => now);
    const validCode = codeOf(access.mint().url);
    for (let i = 0; i < 8; i++) {
      expect(claim(access, "0".repeat(64))).toBeUndefined();
    }
    expect(access.isRateLimited()).toBe(true);
    // Even the valid code is refused while rate-limited, without consuming the invitation.
    expect(claim(access, validCode)).toBeUndefined();
    // Advance past the 60s rate-limit window (still within the 15m invitation window).
    now += 61_000;
    expect(access.isRateLimited()).toBe(false);
    expect(claim(access, validCode)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lists paired devices, updates lastSeenAt, renames, revokes by id or all, and allows self-disconnect", () => {
    let now = 5_000;
    const access = createRemoteAccess(ORIGIN, PORT, () => now);
    const token1 = claim(access, codeOf(access.mint().url), {
      headers: {
        host: HOST,
        origin: ORIGIN,
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
      },
    })!;
    now = 6_000;
    const token2 = claim(access, codeOf(access.mint().url), {
      headers: { host: HOST, origin: ORIGIN, "user-agent": "Mozilla/5.0 (Linux; Android 15)" },
    })!;

    let devices = access.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({ name: "iPhone", createdAt: 5_000, lastSeenAt: 5_000 });
    expect(devices[1]).toMatchObject({
      name: "Android phone",
      createdAt: 6_000,
      lastSeenAt: 6_000,
    });

    // Authorizing a request updates lastSeenAt.
    now = 9_500;
    expect(access.authorize(request({ cookies: { [remoteCookieName(PORT)]: token1 } }))).toEqual({
      kind: "pass",
    });
    devices = access.listDevices();
    expect(devices[0]!.lastSeenAt).toBe(9_500);

    // Rename device 1.
    expect(access.renameDevice(devices[0]!.id, "My iPhone 16")).toBe(true);
    expect(access.listDevices()[0]!.name).toBe("My iPhone 16");
    expect(access.renameDevice("nonexistent", "Other")).toBe(false);

    // Revoke device 1; device 2 stays authorized.
    expect(access.revokeDevice(devices[0]!.id)).toBe(true);
    expect(
      access.authorize(request({ cookies: { [remoteCookieName(PORT)]: token1 } })),
    ).toMatchObject({ status: 401 });
    expect(access.authorize(request({ cookies: { [remoteCookieName(PORT)]: token2 } }))).toEqual({
      kind: "pass",
    });

    // Self-disconnect from device 2.
    expect(
      access.disconnect(
        request({
          method: "POST",
          url: "/remote/disconnect",
          cookies: { [remoteCookieName(PORT)]: token2 },
        }),
      ),
    ).toBe(true);
    expect(
      access.authorize(request({ cookies: { [remoteCookieName(PORT)]: token2 } })),
    ).toMatchObject({ status: 401 });
    expect(access.listDevices()).toHaveLength(0);
  });
});
