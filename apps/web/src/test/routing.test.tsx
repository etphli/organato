import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { App } from "../App";
import { loadWorkPage } from "../pages/routeLoaders";
import { OrganatoProvider } from "../state/OrganatoProvider";

describe("Primary navigation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("switches between assignments and checkpoints without retaining route state", async () => {
    await loadWorkPage();
    render(
      <MemoryRouter initialEntries={["/assignments"]}>
        <OrganatoProvider>
          <App />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Assignments" });
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(
      screen.getByRole("textbox", { name: "Work item name" }),
    ).toBeVisible();

    fireEvent.click(screen.getAllByRole("link", { name: "Checkpoints" })[0]!);

    expect(
      await screen.findByRole("heading", { name: "Checkpoints" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Work item name" }),
    ).not.toBeInTheDocument();
  });
});
