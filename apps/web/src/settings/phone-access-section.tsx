import {
  CheckCircle2,
  CircleAlert,
  Copy,
  LogOut,
  Pencil,
  QrCode,
  RefreshCw,
  Smartphone,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { errorMessage } from "@/api/errors";
import { Button } from "@/components/ui/button";
import { formatClockTime, notificationTime } from "@/lib/time";
import { cn } from "@/lib/utils";

import { copyText } from "./copy-text";
import { rowInputCls, SettingRow } from "./fields";
import { encodeQrMatrix, qrSvgPath } from "./qr-code";
import { SettingsGroup } from "./settings-group";

export type TailscaleReadinessState =
  | "notInstalled"
  | "notRunning"
  | "notSignedIn"
  | "unreachable"
  | "httpsDisabled"
  | "notConfigured"
  | "serveNotConfigured"
  | "funnelEnabled"
  | "ready";

export interface TailscaleStatusView {
  readonly state: TailscaleReadinessState;
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

export interface PairedDeviceView {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly expiresAt: number;
}

export interface RemoteAccessStatusResponse {
  readonly enabled: boolean;
  readonly origin: string | null;
  readonly port: number;
  readonly tailscale: TailscaleStatusView;
  readonly devices: readonly PairedDeviceView[];
}

declare global {
  interface Window {
    gramMockRemoteStatus?: RemoteAccessStatusResponse;
    gramMockPairInvitation?: { readonly url: string; readonly expiresAt: number };
  }
}

const STATE_BADGES: Readonly<
  Record<TailscaleReadinessState, { readonly label: string; readonly tone: string }>
> = {
  notInstalled: { label: "Not installed", tone: "bg-muted text-muted-foreground" },
  notRunning: { label: "Not running", tone: "bg-warning/15 text-warning" },
  notSignedIn: { label: "Not signed in", tone: "bg-warning/15 text-warning" },
  unreachable: { label: "Tailnet unreachable", tone: "bg-warning/15 text-warning" },
  httpsDisabled: { label: "HTTPS / MagicDNS off", tone: "bg-warning/15 text-warning" },
  notConfigured: { label: "Off (opt-in)", tone: "bg-muted text-muted-foreground" },
  serveNotConfigured: { label: "Serve not running", tone: "bg-warning/15 text-warning" },
  funnelEnabled: { label: "Funnel refused", tone: "bg-destructive/15 text-destructive" },
  ready: { label: "Ready", tone: "bg-success/15 text-success" },
};

const isRemoteTailnetBrowser = (): boolean =>
  typeof window !== "undefined" && /\.ts\.net$/i.test(window.location.hostname);

export function PhoneAccessSettings() {
  const onRemotePhone = isRemoteTailnetBrowser();
  if (onRemotePhone) return <RemotePhoneConnectionSection />;
  return <DesktopPhoneAccessSection />;
}

/** Shown when Settings → General is opened from a paired phone over Tailscale Serve. */
function RemotePhoneConnectionSection() {
  const [busy, setBusy] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [error, setError] = useState<string>();

  const disconnect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/remote/disconnect", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError("Couldn't disconnect this phone.");
        return;
      }
      setDisconnected(true);
      window.location.reload();
    } catch (e) {
      setError(errorMessage(e) || "Couldn't disconnect this phone.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsGroup label="Phone access">
      <SettingRow
        label="Tailnet connection"
        description={`Connected to ${window.location.host} over Tailscale Serve.`}
        keywords={["phone", "mobile", "tailscale", "remote", "disconnect", "forget"]}
        error={error}
      >
        <Button
          size="sm"
          variant="outline"
          data-testid="disconnect-phone-button"
          disabled={busy || disconnected}
          onClick={() => void disconnect()}
        >
          <LogOut data-icon="inline-start" />
          {disconnected ? "Disconnected" : "Disconnect and forget"}
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}

/** Shown on the local desktop Gram instance. */
function DesktopPhoneAccessSection() {
  const [statusData, setStatusData] = useState<RemoteAccessStatusResponse | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    if (window.gramMockRemoteStatus !== undefined) return window.gramMockRemoteStatus;
    try {
      const saved = sessionStorage.getItem("gram.mock.remoteStatus");
      if (saved) return JSON.parse(saved) as RemoteAccessStatusResponse;
    } catch {
      // Ignore malformed sessionStorage.
    }
    return undefined;
  });
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<{
    readonly url: string;
    readonly expiresAt: number;
  }>();
  const [showQr, setShowQr] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [draftName, setDraftName] = useState("");

  const fetchStatus = useCallback(async () => {
    const mockStatus = typeof window !== "undefined" ? window.gramMockRemoteStatus : undefined;
    if (mockStatus !== undefined) {
      setStatusData(mockStatus);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/remote/status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.ok) {
        const json = (await response.json()) as RemoteAccessStatusResponse;
        setStatusData(json);
      }
    } catch {
      // In pure browser mock mode without a backend, leave statusData undefined unless seeded.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.gramMockRemoteStatus !== undefined) return;
    if (window.location.hostname === "" || window.location.port === "3000") return;
    fetch("/remote/status", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((response) =>
        response.ok ? (response.json() as Promise<RemoteAccessStatusResponse>) : undefined,
      )
      .then((json) => {
        if (json !== undefined) setStatusData(json);
      })
      .catch(() => {
        // Pure browser mock mode has no HTTP backend unless seeded.
      });
  }, []);

  const mintInvitation = async (revealQr: boolean) => {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const mockInvite =
        typeof window !== "undefined"
          ? (window.gramMockPairInvitation ??
            (() => {
              try {
                const raw = sessionStorage.getItem("gram.mock.pairInvitation");
                return raw
                  ? (JSON.parse(raw) as { readonly url: string; readonly expiresAt: number })
                  : undefined;
              } catch {
                return undefined;
              }
            })())
          : undefined;
      if (mockInvite !== undefined) {
        setInvitation(mockInvite);
        setShowQr(revealQr);
        await copyText(mockInvite.url);
        setNotice(`Pairing link copied — valid until ${formatClockTime(mockInvite.expiresAt)}.`);
        return;
      }
      const response = await fetch("/remote/pair", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError(
          "Phone access is off. Start Gram with GRAM_REMOTE_ORIGIN set to your HTTPS .ts.net origin and Tailscale Serve running.",
        );
        return;
      }
      const data = (await response.json()) as { url?: unknown; expiresAt?: unknown };
      if (typeof data.url !== "string" || typeof data.expiresAt !== "number") {
        setError("Pairing unavailable.");
        return;
      }
      const next = { url: data.url, expiresAt: data.expiresAt };
      setInvitation(next);
      setShowQr(revealQr);
      await copyText(next.url);
      setNotice(`Pairing link copied — valid until ${formatClockTime(next.expiresAt)}.`);
    } catch (e) {
      setError(errorMessage(e) || "Couldn't create a pairing link.");
    } finally {
      setBusy(false);
    }
  };

  const renameDevice = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    setError(undefined);
    if (
      typeof window !== "undefined" &&
      (window.gramMockRemoteStatus !== undefined ||
        sessionStorage.getItem("gram.mock.remoteStatus") !== null)
    ) {
      setStatusData((prev) =>
        prev === undefined
          ? prev
          : {
              ...prev,
              devices: prev.devices.map((d) => (d.id === id ? { ...d, name: trimmed } : d)),
            },
      );
      setEditingId(undefined);
      return;
    }
    try {
      const response = await fetch("/remote/devices/rename", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, name: trimmed }),
      });
      if (!response.ok) {
        setError("Couldn't rename the paired device.");
        return;
      }
      const json = (await response.json()) as { devices: readonly PairedDeviceView[] };
      setStatusData((prev) => (prev ? { ...prev, devices: json.devices } : prev));
      setEditingId(undefined);
    } catch (e) {
      setError(errorMessage(e) || "Couldn't rename the paired device.");
    }
  };

  const revokeDevice = async (target: { id?: string; all?: boolean }) => {
    setError(undefined);
    if (
      typeof window !== "undefined" &&
      (window.gramMockRemoteStatus !== undefined ||
        sessionStorage.getItem("gram.mock.remoteStatus") !== null)
    ) {
      setStatusData((prev) =>
        prev === undefined
          ? prev
          : {
              ...prev,
              devices: target.all ? [] : prev.devices.filter((d) => d.id !== target.id),
            },
      );
      return;
    }
    try {
      const response = await fetch("/remote/devices/revoke", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!response.ok) {
        setError("Couldn't revoke the paired device.");
        return;
      }
      const json = (await response.json()) as { devices: readonly PairedDeviceView[] };
      setStatusData((prev) => (prev ? { ...prev, devices: json.devices } : prev));
    } catch (e) {
      setError(errorMessage(e) || "Couldn't revoke the paired device.");
    }
  };

  const qr = useMemo(() => {
    if (!showQr || !invitation) return undefined;
    try {
      return qrSvgPath(encodeQrMatrix(invitation.url), 2);
    } catch {
      return undefined;
    }
  }, [showQr, invitation]);

  const ts = statusData?.tailscale;
  const badge = ts ? STATE_BADGES[ts.state] : undefined;
  const devices = statusData?.devices ?? [];

  return (
    <SettingsGroup
      label="Phone access"
      description="Opt-in access from a phone browser on your private Tailscale tailnet. Never uses public Funnel."
    >
      {ts && (
        <div
          data-testid="tailscale-status-card"
          data-state={ts.state}
          className="flex flex-col gap-2 rounded-(--radius-md) border border-border bg-card/50 p-3 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            {ts.state === "ready" ? (
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success" />
            ) : ts.state === "notInstalled" || ts.state === "notConfigured" ? (
              <Smartphone aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            ) : ts.state === "unreachable" ? (
              <WifiOff aria-hidden className="size-4 shrink-0 text-warning" />
            ) : (
              <CircleAlert aria-hidden className="size-4 shrink-0 text-warning" />
            )}
            <span className="font-medium text-foreground">Tailscale</span>
            {badge && (
              <span
                data-testid="tailscale-state-badge"
                className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", badge.tone)}
              >
                {badge.label}
              </span>
            )}
            {ts.dnsName && <span className="font-mono text-muted-foreground">{ts.dnsName}</span>}
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Re-check Tailscale"
              title="Re-check Tailscale"
              disabled={loading}
              className="ml-auto text-muted-foreground"
              onClick={() => void fetchStatus()}
            >
              <RefreshCw aria-hidden className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
          <p data-testid="tailscale-status-message" className="text-muted-foreground">
            {ts.message}
          </p>
          {(ts.state === "notConfigured" || ts.state === "serveNotConfigured") &&
            ts.serveCommand && (
              <div className="flex flex-col gap-1.5 pt-1">
                {ts.launchCommand && ts.state === "notConfigured" && (
                  <CommandLine label="1. Start Gram with origin" command={ts.launchCommand} />
                )}
                <CommandLine
                  label={
                    ts.state === "notConfigured"
                      ? "2. Expose on tailnet only"
                      : "Expose on tailnet only"
                  }
                  command={ts.serveCommand}
                />
              </div>
            )}
        </div>
      )}

      <SettingRow
        label="Pair phone"
        description="Creates a single-use 15-minute pairing link and QR code for a phone on your tailnet."
        keywords={["phone", "mobile", "tailscale", "remote", "pair", "pairing", "qr"]}
        error={error}
        detail={
          <div className="flex flex-col gap-2">
            {notice && (
              <p
                role="status"
                data-testid="pair-phone-status"
                className="text-xs text-muted-foreground"
              >
                {notice}
              </p>
            )}
            {qr && invitation && (
              <div
                data-testid="pair-phone-qr"
                className="mt-1 flex flex-wrap items-center gap-4 rounded-(--radius-md) border border-border bg-card p-3"
              >
                <div className="rounded-sm bg-white p-2 shadow-xs">
                  <svg
                    role="img"
                    aria-label="Phone pairing QR code"
                    viewBox={qr.viewBox}
                    className="size-36 text-black"
                    shapeRendering="crispEdges"
                  >
                    <path d={qr.path} fill="currentColor" />
                  </svg>
                </div>
                <div className="flex min-w-44 flex-1 flex-col gap-1.5 text-xs">
                  <p className="font-medium text-foreground">Scan with your phone camera</p>
                  <p className="text-muted-foreground">
                    Single-use link over your tailnet. Expires at{" "}
                    <span className="font-mono tabular-nums">
                      {formatClockTime(invitation.expiresAt)}
                    </span>
                    .
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void copyText(invitation.url)}
                    >
                      <Copy data-icon="inline-start" />
                      Copy link again
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setShowQr(false)}>
                      Hide QR
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            data-testid="pair-phone-qr-button"
            disabled={busy}
            onClick={() => void mintInvitation(true)}
          >
            <QrCode data-icon="inline-start" />
            Show QR code
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="pair-phone-button"
            disabled={busy}
            onClick={() => void mintInvitation(false)}
          >
            <Copy data-icon="inline-start" />
            Copy pairing link
          </Button>
        </div>
      </SettingRow>

      {statusData?.enabled && (
        <div data-testid="paired-devices-section" className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">
              Paired devices ({devices.length} of 8)
            </h4>
            {devices.length > 1 && (
              <Button
                size="xs"
                variant="ghost"
                data-testid="revoke-all-devices"
                className="text-destructive hover:text-destructive"
                onClick={() => void revokeDevice({ all: true })}
              >
                Revoke all
              </Button>
            )}
          </div>
          {devices.length === 0 ? (
            <p
              data-testid="paired-devices-empty"
              className="rounded-(--radius-md) border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground"
            >
              No phones paired yet.
            </p>
          ) : (
            <ul data-testid="paired-devices-list" className="flex flex-col gap-1.5">
              {devices.map((device) => {
                const isEditing = editingId === device.id;
                return (
                  <li
                    key={device.id}
                    data-testid="paired-device-row"
                    data-device-id={device.id}
                    className="flex flex-wrap items-center gap-2 rounded-(--radius-md) border border-border bg-card/50 px-3 py-2 text-xs"
                  >
                    <Smartphone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    {isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void renameDevice(device.id, draftName);
                        }}
                      >
                        <input
                          aria-label="Device name"
                          data-testid="paired-device-name-input"
                          className={cn(rowInputCls, "h-7 w-44 text-xs")}
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                        />
                        <Button size="xs" type="submit" data-testid="paired-device-save-name">
                          Save
                        </Button>
                        <Button
                          size="xs"
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingId(undefined)}
                        >
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span
                          data-testid="paired-device-name"
                          className="truncate font-medium text-foreground"
                        >
                          {device.name}
                        </span>
                        <span
                          data-testid="paired-device-times"
                          className="text-[11px] text-muted-foreground tabular-nums"
                        >
                          Last seen {formatClockTime(device.lastSeenAt)} · Paired{" "}
                          {notificationTime(device.createdAt)}
                        </span>
                      </div>
                    )}
                    {!isEditing && (
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Rename ${device.name}`}
                          title="Rename device"
                          data-testid="paired-device-rename"
                          onClick={() => {
                            setEditingId(device.id);
                            setDraftName(device.name);
                          }}
                        >
                          <Pencil aria-hidden className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Revoke ${device.name}`}
                          title="Revoke device"
                          data-testid="paired-device-revoke"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void revokeDevice({ id: device.id })}
                        >
                          <Trash2 aria-hidden className="size-3.5" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </SettingsGroup>
  );
}

function CommandLine({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-background/60 px-2 py-1">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}:</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
        {command}
      </code>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => {
          void copyText(command).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
