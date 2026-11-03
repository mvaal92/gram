import { findOnPath, PathProbe, Proc } from "@gram/git";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { homedir } from "node:os";

export type TailscaleState =
  | "notInstalled"
  | "notRunning"
  | "notSignedIn"
  | "unreachable"
  | "httpsDisabled"
  | "notConfigured"
  | "serveNotConfigured"
  | "funnelEnabled"
  | "ready";

export interface TailscaleStatusInfo {
  readonly state: TailscaleState;
  readonly version?: string | undefined;
  readonly dnsName?: string | undefined;
  readonly tailnetName?: string | undefined;
  readonly suggestedOrigin?: string | undefined;
  readonly configuredOrigin?: string | undefined;
  readonly serveConfigured: boolean;
  readonly funnelEnabled: boolean;
  readonly loopbackPort: number;
  readonly serveCommand?: string | undefined;
  readonly launchCommand?: string | undefined;
  readonly message: string;
}

export interface TailscaleProbe {
  readonly path: Effect.Effect<string>;
  readonly which: (bin: string, pathValue: string) => string | undefined;
  readonly run: (
    file: string,
    args: ReadonlyArray<string>,
  ) => Effect.Effect<
    { readonly status: number; readonly stdout: string; readonly stderr?: string },
    unknown
  >;
}

const PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_HTTPS_PORT = 9443;

const trimTrailingDot = (value: string): string => value.replace(/\.$/, "");

const isCanonicalTsNetHost = (host: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.ts\.net$/.test(host);

/**
 * Parses `tailscale status --json` and `tailscale serve status --json` outputs (pure, deterministic)
 * against `configuredOrigin` and `loopbackPort`. Never trusts host environment by default in tests.
 */
export function classifyTailscaleStatus(input: {
  readonly installed: boolean;
  readonly statusExit?: { readonly status: number; readonly stdout: string } | undefined;
  readonly serveExit?: { readonly status: number; readonly stdout: string } | undefined;
  readonly configuredOrigin?: string | undefined;
  readonly loopbackPort: number;
}): TailscaleStatusInfo {
  const { installed, statusExit, serveExit, configuredOrigin, loopbackPort } = input;
  if (!installed) {
    return {
      state: "notInstalled",
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message:
        "Tailscale is not installed on this machine. Install Tailscale to connect a phone over your tailnet.",
    };
  }
  if (statusExit === undefined || statusExit.status !== 0 || statusExit.stdout.trim() === "") {
    return {
      state: "notRunning",
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: "Tailscale is not running. Start the Tailscale app or daemon and try again.",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(statusExit.stdout);
    if (typeof raw !== "object" || raw === null) throw new Error("invalid json");
    parsed = raw as Record<string, unknown>;
  } catch {
    return {
      state: "notRunning",
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: "Couldn't read Tailscale status. Restart Tailscale and check again.",
    };
  }

  const version = typeof parsed["Version"] === "string" ? parsed["Version"] : undefined;
  const backendState = typeof parsed["BackendState"] === "string" ? parsed["BackendState"] : "";
  if (backendState === "Stopped") {
    return {
      state: "notRunning",
      ...(version === undefined ? {} : { version }),
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: "Tailscale is stopped. Turn on Tailscale to connect to your tailnet.",
    };
  }
  if (
    backendState === "NeedsLogin" ||
    backendState === "NoState" ||
    backendState === "NeedsMachineAuth"
  ) {
    return {
      state: "notSignedIn",
      ...(version === undefined ? {} : { version }),
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: "Tailscale is not signed in. Run tailscale login or sign in from the Tailscale app.",
    };
  }

  const self =
    typeof parsed["Self"] === "object" && parsed["Self"] !== null
      ? (parsed["Self"] as Record<string, unknown>)
      : undefined;
  const online = self?.["Online"] === true;
  if (backendState !== "Running" || !online) {
    return {
      state: "unreachable",
      ...(version === undefined ? {} : { version }),
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: "This machine is offline on your tailnet. Reconnect Tailscale and check again.",
    };
  }

  const rawDns =
    typeof self?.["DNSName"] === "string" ? trimTrailingDot(self["DNSName"].toLowerCase()) : "";
  const magicSuffix =
    typeof parsed["MagicDNSSuffix"] === "string"
      ? trimTrailingDot(parsed["MagicDNSSuffix"].toLowerCase())
      : "";
  const certDomains = Array.isArray(parsed["CertDomains"])
    ? parsed["CertDomains"]
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.toLowerCase())
    : [];
  const currentTailnet =
    typeof parsed["CurrentTailnet"] === "object" && parsed["CurrentTailnet"] !== null
      ? (parsed["CurrentTailnet"] as Record<string, unknown>)
      : undefined;
  const tailnetName =
    typeof currentTailnet?.["Name"] === "string"
      ? currentTailnet["Name"]
      : magicSuffix || undefined;
  const magicDnsEnabled =
    currentTailnet?.["MagicDNSEnabled"] !== false && rawDns !== "" && isCanonicalTsNetHost(rawDns);
  const httpsEnabled = certDomains.length > 0 && certDomains.includes(rawDns);

  if (!magicDnsEnabled || !httpsEnabled) {
    return {
      state: "httpsDisabled",
      ...(version === undefined ? {} : { version }),
      ...(rawDns !== "" ? { dnsName: rawDns } : {}),
      ...(tailnetName === undefined ? {} : { tailnetName }),
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      message: !magicDnsEnabled
        ? "MagicDNS is not enabled on this tailnet. Enable MagicDNS and HTTPS Certificates in the Tailscale DNS admin console."
        : "HTTPS certificates are not enabled on this tailnet. Enable HTTPS Certificates in the Tailscale DNS admin console.",
    };
  }

  const suggestedOrigin = `https://${rawDns}:${DEFAULT_HTTPS_PORT}`;
  const targetOrigin = configuredOrigin ?? suggestedOrigin;
  const targetUrl = new URL(targetOrigin);
  const httpsPort = targetUrl.port ? Number(targetUrl.port) : 443;
  const serveCommand = `tailscale serve --bg --https=${httpsPort} http://127.0.0.1:${loopbackPort}`;
  const launchCommand = `GRAM_REMOTE_ORIGIN=${targetOrigin}`;

  const { serveConfigured, funnelEnabled } = inspectServeConfig(
    serveExit,
    targetUrl.hostname,
    httpsPort,
    loopbackPort,
  );

  if (funnelEnabled) {
    return {
      state: "funnelEnabled",
      ...(version === undefined ? {} : { version }),
      dnsName: rawDns,
      ...(tailnetName === undefined ? {} : { tailnetName }),
      suggestedOrigin,
      ...(configuredOrigin === undefined ? {} : { configuredOrigin }),
      serveConfigured,
      funnelEnabled: true,
      loopbackPort,
      serveCommand,
      launchCommand,
      message:
        "Tailscale Funnel is enabled on this port. Gram refuses public Funnel exposure; disable Funnel and use tailnet-only tailscale serve.",
    };
  }

  if (configuredOrigin === undefined) {
    return {
      state: "notConfigured",
      ...(version === undefined ? {} : { version }),
      dnsName: rawDns,
      ...(tailnetName === undefined ? {} : { tailnetName }),
      suggestedOrigin,
      serveConfigured,
      funnelEnabled: false,
      loopbackPort,
      serveCommand,
      launchCommand,
      message: `Phone access is off by default. Start Gram with ${launchCommand} and forward with ${serveCommand}.`,
    };
  }

  if (!serveConfigured) {
    return {
      state: "serveNotConfigured",
      ...(version === undefined ? {} : { version }),
      dnsName: rawDns,
      ...(tailnetName === undefined ? {} : { tailnetName }),
      suggestedOrigin,
      configuredOrigin,
      serveConfigured: false,
      funnelEnabled: false,
      loopbackPort,
      serveCommand,
      launchCommand,
      message: `Tailscale is signed in, but Tailscale Serve is not forwarding ${configuredOrigin} to 127.0.0.1:${loopbackPort} yet.`,
    };
  }

  return {
    state: "ready",
    ...(version === undefined ? {} : { version }),
    dnsName: rawDns,
    ...(tailnetName === undefined ? {} : { tailnetName }),
    suggestedOrigin,
    configuredOrigin,
    serveConfigured: true,
    funnelEnabled: false,
    loopbackPort,
    serveCommand,
    launchCommand,
    message: `Ready on ${configuredOrigin} over your private tailnet.`,
  };
}

function inspectServeConfig(
  serveExit: { readonly status: number; readonly stdout: string } | undefined,
  hostname: string,
  httpsPort: number,
  loopbackPort: number,
): { readonly serveConfigured: boolean; readonly funnelEnabled: boolean } {
  if (serveExit === undefined || serveExit.status !== 0 || serveExit.stdout.trim() === "") {
    return { serveConfigured: false, funnelEnabled: false };
  }
  try {
    const raw: unknown = JSON.parse(serveExit.stdout);
    if (typeof raw !== "object" || raw === null)
      return { serveConfigured: false, funnelEnabled: false };
    const doc = raw as Record<string, unknown>;
    const hostPortKey = httpsPort === 443 ? `${hostname}:443` : `${hostname}:${httpsPort}`;
    const allowFunnel =
      typeof doc["AllowFunnel"] === "object" && doc["AllowFunnel"] !== null
        ? (doc["AllowFunnel"] as Record<string, unknown>)
        : {};
    const funnelEnabled = Object.entries(allowFunnel).some(
      ([key, enabled]) =>
        enabled === true &&
        (key.toLowerCase() === hostPortKey || key.toLowerCase().startsWith(`${hostname}:`)),
    );
    const web =
      typeof doc["Web"] === "object" && doc["Web"] !== null
        ? (doc["Web"] as Record<string, unknown>)
        : {};
    const entry = Object.entries(web).find(([key]) => key.toLowerCase() === hostPortKey)?.[1];
    if (typeof entry !== "object" || entry === null) {
      return { serveConfigured: false, funnelEnabled };
    }
    const handlers = (entry as Record<string, unknown>)["Handlers"];
    if (typeof handlers !== "object" || handlers === null) {
      return { serveConfigured: false, funnelEnabled };
    }
    const rootHandler = (handlers as Record<string, unknown>)["/"];
    if (typeof rootHandler !== "object" || rootHandler === null) {
      return { serveConfigured: false, funnelEnabled };
    }
    const proxy = (rootHandler as Record<string, unknown>)["Proxy"];
    const expected = [
      `http://127.0.0.1:${loopbackPort}`,
      `http://localhost:${loopbackPort}`,
      `127.0.0.1:${loopbackPort}`,
    ];
    const serveConfigured =
      typeof proxy === "string" && expected.includes(proxy.replace(/\/$/, "").toLowerCase());
    return { serveConfigured, funnelEnabled };
  } catch {
    return { serveConfigured: false, funnelEnabled: false };
  }
}

export const probeTailscaleStatus = (
  probe: TailscaleProbe,
  options: { readonly configuredOrigin?: string | undefined; readonly loopbackPort: number },
): Effect.Effect<TailscaleStatusInfo> =>
  Effect.gen(function* () {
    const pathValue = yield* probe.path;
    const bin = probe.which("tailscale", pathValue);
    if (bin === undefined) {
      return classifyTailscaleStatus({
        installed: false,
        configuredOrigin: options.configuredOrigin,
        loopbackPort: options.loopbackPort,
      });
    }
    const [statusExit, serveExit] = yield* Effect.all(
      [
        probe.run(bin, ["status", "--json"]).pipe(Effect.orElseSucceed(() => undefined)),
        probe.run(bin, ["serve", "status", "--json"]).pipe(Effect.orElseSucceed(() => undefined)),
      ],
      { concurrency: "unbounded" },
    );
    return classifyTailscaleStatus({
      installed: true,
      statusExit,
      serveExit,
      configuredOrigin: options.configuredOrigin,
      loopbackPort: options.loopbackPort,
    });
  });

export const liveTailscaleProbe = Effect.gen(function* () {
  const proc = yield* Effect.serviceOption(Proc);
  const pathProbe = yield* Effect.serviceOption(PathProbe);
  if (Option.isNone(proc)) {
    return {
      path: Effect.succeed(""),
      which: () => undefined,
      run: () => Effect.fail(new Error("Proc service unavailable")),
    } satisfies TailscaleProbe;
  }
  return {
    path: Option.isSome(pathProbe)
      ? pathProbe.value.path
      : Effect.sync(() => process.env["PATH"] ?? process.env["Path"] ?? ""),
    which: (bin, pathValue) => findOnPath(bin, pathValue, process.platform),
    run: (file, args) =>
      proc.value.run(file, args, { cwd: homedir(), timeoutMs: PROBE_TIMEOUT_MS }),
  } satisfies TailscaleProbe;
});
