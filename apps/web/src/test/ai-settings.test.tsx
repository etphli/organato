import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsSection } from "../components/settings/AiSettingsSection";
import { IntegrationRequestError } from "../lib/integrationApi";

vi.mock("../lib/ai", () => ({ aiDemoMode: false }));
const api = vi.hoisted(() => ({ request: vi.fn(), reauthenticate: vi.fn() }));
vi.mock("../lib/integrationApi", async (original) => ({
  ...(await original<typeof import("../lib/integrationApi")>()),
  integrationRequest: api.request,
  reauthenticate: api.reauthenticate,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const initial = {
  model: "test/model:free",
  enabled: false,
  hasKey: false,
  personal: false,
  sharedAvailable: false,
};
describe("AI connection settings", () => {
  it("saves a key, clears the password field, tests it, and removes the connection", async () => {
    api.request.mockResolvedValue(initial);
    render(<AiSettingsSection />);
    await waitFor(() =>
      expect(screen.getByLabelText(/OpenRouter API key/)).not.toBeDisabled(),
    );
    fireEvent.change(screen.getByLabelText(/OpenRouter API key/), {
      target: { value: "test-secret-key" },
    });
    fireEvent.click(screen.getByLabelText("Enable AI suggestions"));
    api.request.mockResolvedValue({
      ...initial,
      hasKey: true,
      personal: true,
      enabled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save AI settings" }));
    await screen.findByText("AI settings saved.");
    expect(api.request).toHaveBeenCalledWith(
      "/api/ai/settings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          model: "test/model:free",
          enabled: true,
          apiKey: "test-secret-key",
        }),
      }),
    );
    expect(screen.getByLabelText(/OpenRouter API key/)).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("OpenRouter verified your saved key.");
    api.request.mockResolvedValue(initial);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove personal connection" }),
    );
    await screen.findByText(
      "Personal key removed. Installation defaults restored.",
    );
    expect(api.request).toHaveBeenCalledWith("/api/ai/settings", {
      method: "DELETE",
    });
  });
  it("shows the sign-in confirmation action when key saving needs recent authentication", async () => {
    api.request.mockResolvedValue(initial);
    render(<AiSettingsSection />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save AI settings" }),
      ).not.toBeDisabled(),
    );
    api.request.mockRejectedValue(
      new IntegrationRequestError(
        "Confirm your Google sign-in before continuing.",
        "reauthentication_required",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save AI settings" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm Google sign-in" }),
    );
    expect(api.reauthenticate).toHaveBeenCalledWith("/settings/ai");
  });
});
