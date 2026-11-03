import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "../src/app";
import { fakeHost } from "./fakes/host";
import type { KenkuiServerClient } from "../src/api/client";
import { KenkuiApiError } from "../src/api/errors";
it("waits for explicit recovery then reopens the original owner's books and credits", async () => {
  const session = vi
    .fn()
    .mockRejectedValueOnce(
      new KenkuiApiError(409, "Recovery", {
        error: {
          code: "recovery_required",
          message: "Recover account",
          requestId: "synthetic",
        },
      }),
    )
    .mockResolvedValue({ userId: "legacy-owner" });
  const challenge = vi.fn().mockResolvedValue({ challengeId: "proof" }),
    verify = vi.fn().mockResolvedValue({ userId: "legacy-owner" }),
    onboard = vi.fn();
  const api = {
    capabilities: async () => ({
      apiVersion: "1",
      auth: { mode: "session" },
      billing: { mode: "credits" },
    }),
    storageScope: () => "studio",
    session,
    challenge,
    verify,
    onboard,
    voices: async () => ({ items: [] }),
    billing: async () => ({ availableCredits: "731" }),
    jobs: async () => ({
      items: [
        {
          id: "old",
          title: "My old audiobook",
          status: "succeeded",
          progress: { stage: "done" },
        },
      ],
    }),
  };
  render(
    <App client={api as unknown as KenkuiServerClient} host={fakeHost()} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Recover existing account" }),
  );
  expect(challenge).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Previous account email"), {
    target: { value: "old@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send recovery code" }));
  fireEvent.change(await screen.findByLabelText("Recovery code"), {
    target: { value: "CODE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify recovery code" }));
  expect(
    await screen.findByRole("button", { name: /My old audiobook/ }),
  ).toBeVisible();
  expect(screen.getByText(/731/)).toBeVisible();
  expect(challenge).toHaveBeenCalledWith("old@example.com");
  expect(verify).toHaveBeenCalledWith("proof", "CODE");
  expect(onboard).not.toHaveBeenCalled();
});

it("uses the pinned managed SDK for request-time Bearers, social login and managed logout", async () => {
  const { browserSession } = await import("../src/auth/neon");
  const { KenkuiServerClient } = await import("../src/api/client");
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/native/config"))
      return Response.json({
        protocolVersion: 2,
        issuer: "https://auth.test/db/auth",
      });
    if (url.includes("/get-session"))
      return Response.json(
        { session: { id: "session" }, user: { id: "user" } },
        { headers: { "set-auth-jwt": "browser.jwt.synthetic" } },
      );
    if (url.includes("/token"))
      return Response.json({ token: "browser.jwt.synthetic" });
    if (url.endsWith("/artifact-url"))
      return Response.json({ url: "https://store.test/book?sig=synthetic" });
    if (url.endsWith("/cover")) return new Response(new Uint8Array([1]));
    return Response.json({ redirect: false });
  };
  vi.stubGlobal("fetch", fetcher);
  let visible = true;
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockImplementation(() => (visible ? "visible" : "hidden"));
  try {
    const session = browserSession("https://api.test", fetcher);
    const api = new KenkuiServerClient("https://api.test", {
      fetch: session.request,
    });
    expect(calls).toEqual([]);
    await api.capabilities();
    expect(calls.length).toBe(1);
    expect(new Headers(calls[0].init?.headers).has("Authorization")).toBe(
      false,
    );
    await session.auth.restore("");
    await api.jobs();
    await api.cover("book");
    expect(
      await session.downloadUrl("https://api.test/v1/jobs/old/artifact"),
    ).toMatch(/^https:\/\/store.test/);
    const protectedCalls = calls.filter(
      (c) =>
        c.url.startsWith("https://api.test/v1/") &&
        !/capabilities|config/.test(c.url),
    );
    expect(protectedCalls.length).toBe(3);
    expect(
      protectedCalls.every(
        (c) =>
          new Headers(c.init?.headers).get("authorization") ===
            "Bearer browser.jwt.synthetic" && c.init?.credentials === "omit",
      ),
    ).toBe(true);
    await expect(
      session.request("https://foreign.test/v1/jobs"),
    ).rejects.toThrow(/outside/);
    const count = calls.length;
    visible = false;
    await session.auth.restore("");
    await expect(api.jobs()).rejects.toThrow(/Resume/);
    expect(calls.length).toBe(count);
    visible = true;
    await session.auth.signIn("", "github");
    await session.auth.signIn("", "google");
    await session.auth.signOut("");
    const social = calls
      .filter((c) => c.url.includes("/sign-in/social"))
      .map((c) => JSON.parse(String(c.init?.body)).provider);
    expect(social).toEqual(["github", "google"]);
    expect(calls.some((c) => c.url.includes("/sign-out"))).toBe(true);
    expect(
      calls
        .filter((c) => c.url.startsWith("https://auth.test"))
        .every((c) => c.init?.credentials === "include"),
    ).toBe(true);
  } finally {
    visibility.mockRestore();
    vi.unstubAllGlobals();
  }
});

it("clears the account UI when a protected request reports expired auth", async () => {
  const { KenkuiServerClient } = await import("../src/api/client");
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith("/capabilities"))
      return Response.json({ apiVersion: "1", auth: { mode: "session" } });
    if (path.endsWith("/session"))
      return Response.json({ userId: "existing-owner" });
    if (path.endsWith("/voices") || path.endsWith("/jobs"))
      return Response.json({ items: [] });
    return Response.json(
      {
        error: {
          code: "unauthenticated",
          message: "Expired",
          requestId: "test",
        },
      },
      { status: 401 },
    );
  });
  const api = new KenkuiServerClient("https://api.test", { fetch: fetcher });
  render(<App client={api} host={fakeHost()} />);
  expect(
    await screen.findByRole("heading", { name: "Your books" }),
  ).toBeVisible();
  const { act } = await import("@testing-library/react");
  await act(async () => {
    await expect(api.cover("old")).rejects.toMatchObject({ status: 401 });
  });
  expect(
    await screen.findByRole("button", { name: "Continue with GitHub" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Your books" })).toBeNull();
});
