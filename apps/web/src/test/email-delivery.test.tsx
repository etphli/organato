import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailDeliverySection } from "../components/settings/EmailDeliverySection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Email delivery settings", () => {
  it("saves an approved school recipient before sending a test email", async () => {
    const connected = {
      connected: true,
      sender: "owner@gmail.com",
      recipients: ["owner@gmail.com"],
      status: "healthy",
      reconnectNeeded: false,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorCategory: null,
    };
    const schoolRecipient = "student@school.edu.au";
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const path = String(input);
        if (path.endsWith("/settings")) {
          return Response.json(connected);
        }
        if (path.endsWith("/recipients") && init?.method === "PUT") {
          expect(JSON.parse(String(init.body))).toEqual({
            recipients: [schoolRecipient],
          });
          return Response.json({
            ...connected,
            recipients: [schoolRecipient],
          });
        }
        if (path.endsWith("/test-email") && init?.method === "POST") {
          return Response.json({ ok: true, messageId: "gmail-message" });
        }
        return Response.json({ error: "Unexpected request" }, { status: 500 });
      });
    const ready = vi.fn();

    render(<EmailDeliverySection onReady={ready} />);

    const input = await screen.findByLabelText("Send reminders to");
    fireEvent.change(input, { target: { value: schoolRecipient } });
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

    expect(
      await screen.findByText(`Test email sent to ${schoolRecipient}.`),
    ).toBeInTheDocument();
    await waitFor(() => expect(ready).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("sends to an unchanged recipient without needlessly saving it again", async () => {
    const recipient = "student@school.edu.au";
    const connected = {
      connected: true,
      sender: "owner@gmail.com",
      recipients: [recipient],
      status: "healthy",
      reconnectNeeded: false,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorCategory: null,
    };
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const path = String(input);
        if (path.endsWith("/settings")) return Response.json(connected);
        if (path.endsWith("/test-email") && init?.method === "POST") {
          return Response.json({ ok: true, messageId: "gmail-message" });
        }
        return Response.json({ error: "Unexpected request" }, { status: 500 });
      });

    render(<EmailDeliverySection />);
    await screen.findByDisplayValue(recipient);
    fireEvent.click(screen.getByRole("button", { name: "Send test email" }));

    expect(
      await screen.findByText(`Test email sent to ${recipient}.`),
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.some(([input]) =>
        String(input).endsWith("/recipients"),
      ),
    ).toBe(false);
  });
});
