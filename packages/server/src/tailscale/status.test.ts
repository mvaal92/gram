import { describe, expect, it } from "vitest";
import { classifyTailscaleStatus } from "./status.ts";

const READY_STATUS_JSON = JSON.stringify({
  Version: "1.76.1",
  BackendState: "Running",
  MagicDNSSuffix: "tail123.ts.net",
  CertDomains: ["macbook.tail123.ts.net"],
  CurrentTailnet: {
    Name: "tail123.ts.net",
    MagicDNSEnabled: true,
  },
  Self: {
    Online: true,
    DNSName: "macbook.tail123.ts.net.",
  },
});

const READY_SERVE_JSON = JSON.stringify({
  Web: {
    "macbook.tail123.ts.net:9443": {
      Handlers: {
        "/": {
          Proxy: "http://127.0.0.1:4317",
        },
      },
    },
  },
});

describe("classifyTailscaleStatus", () => {
  it("reports notInstalled when tailscale is absent from PATH", () => {
    const status = classifyTailscaleStatus({
      installed: false,
      loopbackPort: 4317,
    });
    expect(status.state).toBe("notInstalled");
    expect(status.serveConfigured).toBe(false);
  });

  it("reports notRunning when the daemon fails or BackendState is Stopped", () => {
    expect(
      classifyTailscaleStatus({
        installed: true,
        statusExit: { status: 1, stdout: "" },
        loopbackPort: 4317,
      }).state,
    ).toBe("notRunning");

    expect(
      classifyTailscaleStatus({
        installed: true,
        statusExit: {
          status: 0,
          stdout: JSON.stringify({ Version: "1.76.1", BackendState: "Stopped" }),
        },
        loopbackPort: 4317,
      }).state,
    ).toBe("notRunning");
  });

  it("reports notSignedIn when BackendState is NeedsLogin or NoState", () => {
    for (const BackendState of ["NeedsLogin", "NoState", "NeedsMachineAuth"]) {
      const status = classifyTailscaleStatus({
        installed: true,
        statusExit: {
          status: 0,
          stdout: JSON.stringify({ Version: "1.76.1", BackendState }),
        },
        loopbackPort: 4317,
      });
      expect(status.state).toBe("notSignedIn");
    }
  });

  it("reports unreachable when the node is offline on the tailnet", () => {
    const status = classifyTailscaleStatus({
      installed: true,
      statusExit: {
        status: 0,
        stdout: JSON.stringify({
          Version: "1.76.1",
          BackendState: "Running",
          Self: { Online: false, DNSName: "macbook.tail123.ts.net." },
        }),
      },
      loopbackPort: 4317,
    });
    expect(status.state).toBe("unreachable");
  });

  it("reports httpsDisabled when MagicDNS or HTTPS CertDomains are missing", () => {
    const noCerts = classifyTailscaleStatus({
      installed: true,
      statusExit: {
        status: 0,
        stdout: JSON.stringify({
          Version: "1.76.1",
          BackendState: "Running",
          MagicDNSSuffix: "tail123.ts.net",
          CertDomains: [],
          CurrentTailnet: { MagicDNSEnabled: true },
          Self: { Online: true, DNSName: "macbook.tail123.ts.net." },
        }),
      },
      loopbackPort: 4317,
    });
    expect(noCerts.state).toBe("httpsDisabled");
    expect(noCerts.message).toContain("HTTPS certificates");

    const noMagicDns = classifyTailscaleStatus({
      installed: true,
      statusExit: {
        status: 0,
        stdout: JSON.stringify({
          Version: "1.76.1",
          BackendState: "Running",
          MagicDNSSuffix: "tail123.ts.net",
          CertDomains: ["macbook.tail123.ts.net"],
          CurrentTailnet: { MagicDNSEnabled: false },
          Self: { Online: true, DNSName: "macbook.tail123.ts.net." },
        }),
      },
      loopbackPort: 4317,
    });
    expect(noMagicDns.state).toBe("httpsDisabled");
    expect(noMagicDns.message).toContain("MagicDNS");
  });

  it("reports notConfigured when Tailscale is ready but GRAM_REMOTE_ORIGIN is unset (opt-in off by default)", () => {
    const status = classifyTailscaleStatus({
      installed: true,
      statusExit: { status: 0, stdout: READY_STATUS_JSON },
      serveExit: { status: 0, stdout: "{}" },
      loopbackPort: 4317,
    });
    expect(status).toMatchObject({
      state: "notConfigured",
      dnsName: "macbook.tail123.ts.net",
      suggestedOrigin: "https://macbook.tail123.ts.net:9443",
      serveCommand: "tailscale serve --bg --https=9443 http://127.0.0.1:4317",
      launchCommand: "GRAM_REMOTE_ORIGIN=https://macbook.tail123.ts.net:9443",
    });
  });

  it("reports serveNotConfigured when GRAM_REMOTE_ORIGIN is set but tailscale serve is not forwarding to loopback", () => {
    const status = classifyTailscaleStatus({
      installed: true,
      statusExit: { status: 0, stdout: READY_STATUS_JSON },
      serveExit: { status: 0, stdout: "{}" },
      configuredOrigin: "https://macbook.tail123.ts.net:9443",
      loopbackPort: 4317,
    });
    expect(status.state).toBe("serveNotConfigured");
    expect(status.serveConfigured).toBe(false);
  });

  it("refuses public Tailscale Funnel when AllowFunnel is enabled", () => {
    const status = classifyTailscaleStatus({
      installed: true,
      statusExit: { status: 0, stdout: READY_STATUS_JSON },
      serveExit: {
        status: 0,
        stdout: JSON.stringify({
          ...JSON.parse(READY_SERVE_JSON),
          AllowFunnel: { "macbook.tail123.ts.net:9443": true },
        }),
      },
      configuredOrigin: "https://macbook.tail123.ts.net:9443",
      loopbackPort: 4317,
    });
    expect(status.state).toBe("funnelEnabled");
    expect(status.funnelEnabled).toBe(true);
  });

  it("reports ready when Tailscale is online, HTTPS is enabled, GRAM_REMOTE_ORIGIN is set, and tailscale serve forwards to loopback", () => {
    const status = classifyTailscaleStatus({
      installed: true,
      statusExit: { status: 0, stdout: READY_STATUS_JSON },
      serveExit: { status: 0, stdout: READY_SERVE_JSON },
      configuredOrigin: "https://macbook.tail123.ts.net:9443",
      loopbackPort: 4317,
    });
    expect(status).toMatchObject({
      state: "ready",
      dnsName: "macbook.tail123.ts.net",
      configuredOrigin: "https://macbook.tail123.ts.net:9443",
      serveConfigured: true,
      funnelEnabled: false,
    });
  });
});
