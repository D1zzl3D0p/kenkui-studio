import { useEffect, useState } from "react";
import type { KenkuiServerClient } from "../api/client";
import type { Capabilities } from "../api/generated/v1";
import type { Host, NoticePermission } from "../host";

/**
 * Where a reader chooses how a finished book reaches them.
 *
 * Each switch appears only where it can actually work: the email one when the
 * server advertises mail, the device one when the platform has notifications.
 * Offering a control that silently does nothing is worse than offering none.
 */
export function NotificationSettings({
  client,
  host,
  capabilities,
}: {
  client: KenkuiServerClient;
  host: Host;
  capabilities: Capabilities;
}) {
  const notifications = host.notifications;
  const emailOffered = Boolean(capabilities.notifications?.email);
  const [permission, setPermission] = useState<NoticePermission>();
  const [email, setEmail] = useState<boolean>();
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void notifications?.permission().then((value) => {
      if (live) setPermission(value);
    });
    return () => {
      live = false;
    };
  }, [notifications]);
  useEffect(() => {
    if (!emailOffered) return;
    let live = true;
    void client
      .notificationPreference()
      .then((value) => {
        if (!live) return;
        setEmail(value.emailOnCompletion);
        setAddress(value.email ?? null);
      })
      .catch(() => {
        if (live) setError("Could not load your email setting.");
      });
    return () => {
      live = false;
    };
  }, [client, emailOffered]);
  if (!emailOffered && !notifications) return null;
  const allow = async () => {
    if (notifications) setPermission(await notifications.request());
  };
  const toggleEmail = async (next: boolean) => {
    setBusy(true);
    setError("");
    try {
      setEmail((await client.setNotificationPreference(next)).emailOnCompletion);
    } catch {
      setError("Could not save your email setting.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="notification-settings" aria-label="Notifications">
      <p className="quiet">When a book finishes</p>
      {notifications &&
        (permission === "granted" ? (
          <p className="quiet">Notifications are on for this device.</p>
        ) : permission === "denied" ? (
          <p className="quiet">
            This device is blocking notifications. Allow them in your browser or system
            settings.
          </p>
        ) : (
          <button type="button" className="secondary full" onClick={() => void allow()}>
            Notify me on this device
          </button>
        ))}
      {emailOffered && email !== undefined && (
        <label className="notification-email">
          <input
            type="checkbox"
            checked={email}
            disabled={busy}
            onChange={(event) => void toggleEmail(event.target.checked)}
          />
          {address ? `Email ${address}` : "Email me"}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
