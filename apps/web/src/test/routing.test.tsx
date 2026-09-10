import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { OrganatoProvider } from "../state/OrganatoProvider";

describe("Primary navigation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("switches between assignments and checkpoints without retaining route state", async () => {
    render(
      <MemoryRouter initialEntries={["/assignments"]}>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    // Coverage instrumentation slows lazy chunk loads, so allow headroom.
    await screen.findByRole(
      "heading",
      { name: "Assignments" },
      { timeout: 15_000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(
      screen.getByRole("textbox", { name: "Work item name" }),
    ).toBeVisible();

    fireEvent.click(screen.getAllByRole("link", { name: "Checkpoints" })[0]!);

    expect(
      await screen.findByRole(
        "heading",
        { name: "Checkpoints" },
        { timeout: 15_000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Work item name" }),
    ).not.toBeInTheDocument();
  });
});
