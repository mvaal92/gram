import { KeyRound, Smartphone } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useApi } from "@/api/context";

/**
 * Covers the app once the server rejects this window's session, usually because Gram
 * restarted with a new launch token or a paired phone was revoked/disconnected. Retrying can't
 * help, so it replaces the reconnect banner.
 */
export function SessionExpiredScreen() {
  const { connection } = useApi();
  const state = useSyncExternalStore(connection.subscribe, connection.get, connection.get);
  if (state.status !== "expired") return null;
  const isRemote = typeof window !== "undefined" && /\.ts\.net$/i.test(window.location.hostname);

  return (
    <div
      role="alert"
      aria-labelledby="session-expired-title"
      data-testid="session-expired"
      className="fixed inset-0 z-100 flex items-center justify-center bg-background p-6"
    >
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        {isRemote ? (
          <Smartphone aria-hidden className="size-6 text-muted-foreground" />
        ) : (
          <KeyRound aria-hidden className="size-6 text-muted-foreground" />
        )}
        <h1 id="session-expired-title" className="font-heading text-lg font-medium">
          {isRemote ? "Phone disconnected" : "Session expired"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isRemote
            ? "This phone is no longer paired with Gram. Scan a fresh QR code or open a pairing link from Settings → General → Phone access on your desktop."
            : "This window's launch token is no longer accepted, usually because Gram restarted. Reopen Gram to start a new session."}
        </p>
      </div>
    </div>
  );
}
