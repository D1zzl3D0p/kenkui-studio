import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createNativeAuth } from "../src/host/native-auth";
import { SignInPage } from "../src/pages/sign-in";
import { AccountMenu } from "../src/components/account-menu";
import { App } from "../src/app";
import { KenkuiServerClient } from "../src/api/client";
import { fakeHost } from "./fakes/host";
import { KenkuiApiError } from "../src/api/errors";

const origin = "https://api.test";
const client = new KenkuiServerClient(origin);
const capabilities = { apiVersion: "1", auth: { mode: "session" } } as const;

describe("native authentication boundary", () => {
  it("only exchanges actions and origin over IPC and reports session changes", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const auth = createNativeAuth(invoke);
    const changed = vi.fn();
    const off = auth.onChanged(changed);
    await auth.restore(origin);
    expect(changed).not.toHaveBeenCalled();
    await auth.signIn(origin);
    await auth.signOut(origin);
    expect(changed).toHaveBeenCalledTimes(2);
    off();
    await auth.signIn(origin);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls).toEqual([
      ["kenkui_auth_restore", { origin }],
      ["kenkui_auth_sign_in", { origin }],
      ["kenkui_auth_sign_out", { origin }],
      ["kenkui_auth_sign_in", { origin }],
    ]);
  });

  it("offers native browser sign-in with cancellation instead of a WebView link", async () => {
    let reject!: (cause: unknown) => void;
    const invoke = vi.fn().mockImplementation((command: string) => command === "kenkui_auth_sign_in"
      ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve());
    const auth = createNativeAuth(invoke);
    render(<SignInPage capabilities={capabilities} client={client} auth={auth} />);
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("status")).toHaveTextContent("browser");
    fireEvent.click(screen.getByRole("button", { name: "Cancel sign-in" }));
    expect(invoke).toHaveBeenCalledWith("kenkui_auth_cancel", {});
    await act(async () => reject("Sign-in cancelled"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in cancelled");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("signs out through native storage rather than submitting a browser form", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<AccountMenu client={client} signedIn initiallyOpen auth={createNativeAuth(invoke)} />);
    expect(container.querySelector("form")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("kenkui_auth_sign_out", { origin }));
  });

  it("restores native credentials before session lookup and retries after sign-in", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const auth = createNativeAuth(invoke);
    const host = fakeHost({ auth });
    const session = vi.fn().mockRejectedValue(new KenkuiApiError(401, "Sign in"));
    const api = {
      capabilities: vi.fn().mockResolvedValue(capabilities),
      session, storageScope: () => origin, onUnauthorized: () => () => undefined,
    } as unknown as KenkuiServerClient;
    render(<App client={api} host={host} initialPath="/sign-in" />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeVisible();
    expect(invoke).toHaveBeenCalledWith("kenkui_auth_restore", { origin });
    expect(session).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(session).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenCalledWith("kenkui_auth_sign_in", { origin });
  });

  it("keeps browser cookie login and logout behavior", () => {
    const { unmount } = render(<SignInPage capabilities={capabilities} client={client} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `${origin}/v1/auth/login`);
    unmount();
    const { container } = render(<AccountMenu client={client} signedIn initiallyOpen />);
    expect(container.querySelector("form")).toHaveAttribute("action", `${origin}/v1/auth/logout`);
  });
});
