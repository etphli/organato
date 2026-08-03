import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IntegrationHealth } from "@organato/domain";
import { BrandMark } from "../components/BrandMark";
import { getShellSyncStatus } from "../components/AppShell";

const integration = (
  state: IntegrationHealth["state"],
  provider: IntegrationHealth["provider"] = "canvas",
): IntegrationHealth => ({
  provider,
  state,
  label: provider === "canvas" ? "Canvas / Reshet" : "Email reminders",
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
});

describe("BrandMark", () => {
  it("is decorative by default and can expose an accessible title", () => {
    const { rerender } = render(<BrandMark size={16} />);
    const mark = document.querySelector("svg");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(mark).toHaveAttribute("height", "16");
    expect(mark).toHaveAttribute("width", "16");
    expect(mark).toHaveAttribute("viewBox", "0 0 32 32");

    rerender(<BrandMark size={16} title="Organato" />);
    expect(screen.getByRole("img", { name: "Organato" })).toBeInTheDocument();
  });

  it("supports a monochrome organizing point", () => {
    const { container } = render(<BrandMark size={16} variant="monochrome" />);
    expect(container.querySelector("svg")).toHaveClass(
      "brand-mark--monochrome",
    );
    expect(container.querySelector(".brand-mark__point")).toBeInTheDocument();
  });
});

describe("shell synchronization status", () => {
  it("is neutral until integrations are connected", () => {
    expect(getShellSyncStatus([], false)).toEqual({
      label: "Not connected",
      tone: "neutral",
    });
    expect(getShellSyncStatus([integration("disconnected")], false)).toEqual({
      label: "Not connected",
      tone: "neutral",
    });
  });

  it("only reports up to date when every integration is healthy", () => {
    expect(
      getShellSyncStatus(
        [integration("healthy"), integration("healthy")],
        false,
      ),
    ).toEqual({ label: "Up to date", tone: "healthy" });
    expect(
      getShellSyncStatus(
        [integration("healthy"), integration("disconnected")],
        false,
      ),
    ).toEqual({ label: "Partly connected", tone: "neutral" });
  });

  it("prioritizes active and actionable states", () => {
    expect(getShellSyncStatus([integration("healthy")], true)).toEqual({
      label: "Syncing…",
      tone: "busy",
    });
    expect(getShellSyncStatus([integration("action_needed")], false)).toEqual({
      label: "Action needed",
      tone: "attention",
      to: "/settings/canvas",
      targetLabel: "Canvas / Reshet",
    });
    expect(
      getShellSyncStatus([integration("delayed", "gmail")], false),
    ).toEqual({
      label: "Sync delayed",
      tone: "attention",
      to: "/settings/email",
      targetLabel: "Email reminders",
    });
  });
});
