import { browserSession } from "../auth/neon";
import { channelEventSourceFactory } from "./channel-event-source";
import { fetchEventChannel } from "./fetch-event-channel";
import type { Host, Notifications, NoticePermission, ServerEntry } from "./index";

/**
 * Browser notifications. Undefined where the API is missing, which keeps the
 * preference hidden rather than offering a switch that cannot work.
 */
export function webNotifications(navigate: (url: string) => void): Notifications | undefined {
  if (typeof Notification === "undefined") return undefined;
  return {
    permission: async () => Notification.permission as NoticePermission,
    request: async () => (await Notification.requestPermission()) as NoticePermission,
    show: async ({ title, body, path }) => {
      if (Notification.permission !== "granted") return;
      // Tagging by destination collapses repeats for one job into one notice.
      const notice = new Notification(title, { body, tag: path });
      notice.onclick = () => {
        window.focus();
        if (path) navigate(path);
      };
    },
  };
}

/**
 * The browser host. The SPA talks to one fixed API: the origin it was served
 * from, or the origin the build was configured with when app and API are split.
 */
export async function createHost(
  { navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void } = {},
): Promise<Host> {
  const origin: ServerEntry = { id: "origin", label: "This server", baseUrl: import.meta.env.VITE_KENKUI_API_ORIGIN ?? "", kind: "origin" };
  const session = browserSession(origin.baseUrl);
  const fetchApi: typeof fetch = async (input, init) => {
    if (session.hosted() && /\/artifact$/.test(String(input))) {
      const signed = await session.downloadUrl(String(input));
      return fetch(signed, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: init?.signal,
      });
    }
    return session.request(input, init);
  };
  return {
    platform: "web",
    can: {
      chooseServer: false,
      reachLoopback: true,
      manageLocalServer: false,
      saveToPath: false,
    },
    auth: session.auth,
    transport: () => ({
      fetch: fetchApi,
      eventSource: channelEventSourceFactory((url, cursor) =>
        fetchEventChannel(fetchApi, url, cursor),
      ),
    }),
    notifications: webNotifications(navigate),
    servers: {
      list: async () => [origin],
      selected: async () => origin,
      select: async () => undefined,
      add: async () => {
        throw new Error("The web app does not support choosing a server.");
      },
      remove: async () => {
        throw new Error("The web app does not support choosing a server.");
      },
    },
    // A hosted artifact is signed on demand; the R2 navigation carries no API Bearer.
    saveArtifact: async ({ url }) => {
      navigate(await session.downloadUrl(url));
    },
    openExternal: async (url) => {
      navigate(url);
    },
    onResume: (listener) => {
      const wake = () => {
        if (document.visibilityState === "visible") listener();
      };
      document.addEventListener("visibilitychange", wake);
      return () => document.removeEventListener("visibilitychange", wake);
    },
  };
}
