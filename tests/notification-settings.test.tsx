import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NotificationSettings } from "../src/components/notification-settings";
import type { KenkuiServerClient } from "../src/api/client";
import type { Capabilities } from "../src/api/generated/v1";
import { fakeHost, fakeNotifications } from "./fakes/host";

const mailing = { notifications: { email: true } } as Capabilities;
const silent = {} as Capabilities;

const clientWith = (emailOnCompletion: boolean, email: string | null = "reader@example.com") => ({
  notificationPreference: vi.fn().mockResolvedValue({ email, emailOnCompletion }),
  setNotificationPreference: vi.fn(async (next: boolean) => ({ email, emailOnCompletion: next })),
});

const show = (client: unknown, host: ReturnType<typeof fakeHost>, capabilities: Capabilities) =>
  render(
    <NotificationSettings
      client={client as KenkuiServerClient}
      host={host}
      capabilities={capabilities}
    />,
  );

it("offers nothing when neither the server nor the device can notify", () => {
  const { container } = show(clientWith(true), fakeHost(), silent);
  expect(container).toBeEmptyDOMElement();
});

it("shows the address a finished book would reach", async () => {
  const client = clientWith(true);
  show(client, fakeHost(), mailing);
  expect(await screen.findByText("Email reader@example.com")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("turning email off saves the reader's choice", async () => {
  const client = clientWith(true);
  show(client, fakeHost(), mailing);
  const toggle = await screen.findByRole("checkbox");

  fireEvent.click(toggle);

  await waitFor(() => expect(client.setNotificationPreference).toHaveBeenCalledWith(false));
  await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
});

it("a failed save says so rather than showing a false setting", async () => {
  const client = {
    notificationPreference: vi.fn().mockResolvedValue({ email: "r@example.com", emailOnCompletion: true }),
    setNotificationPreference: vi.fn().mockRejectedValue(new Error("offline")),
  };
  show(client, fakeHost(), mailing);
  fireEvent.click(await screen.findByRole("checkbox"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your email setting.");
  expect(screen.getByRole("checkbox")).toBeChecked();
});

it("a device that has not been asked is offered the choice", async () => {
  const notifications = fakeNotifications("default");
  show(clientWith(true), fakeHost({ notifications }), silent);

  fireEvent.click(await screen.findByRole("button", { name: "Notify me on this device" }));

  await waitFor(() => expect(notifications.request).toHaveBeenCalled());
  expect(await screen.findByText("Notifications are on for this device.")).toBeInTheDocument();
});

it("a blocked device is told where to unblock rather than asked again", async () => {
  const notifications = fakeNotifications("denied");
  show(clientWith(true), fakeHost({ notifications }), silent);

  expect(await screen.findByText(/blocking notifications/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Notify me on this device" })).toBeNull();
});

it("a server without mail offers only the device switch", async () => {
  const client = clientWith(true);
  show(client, fakeHost({ notifications: fakeNotifications("granted") }), silent);

  expect(await screen.findByText("Notifications are on for this device.")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(client.notificationPreference).not.toHaveBeenCalled();
});
