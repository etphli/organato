import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WorkPage from "../pages/WorkPage";
import { OrganatoProvider } from "../state/OrganatoProvider";

function renderAssignments() {
  return render(
    <MemoryRouter>
      <OrganatoProvider>
        <WorkPage page="assignments" />
      </OrganatoProvider>
    </MemoryRouter>,
  );
}

describe("Assignments completion visibility", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("hides completed work by default and persists the visibility toggle", () => {
    const firstRender = renderAssignments();

    expect(
      screen.queryByText("Design folio submission"),
    ).not.toBeInTheDocument();
    const showCompleted = screen.getByRole("button", {
      name: "Show completed",
    });
    expect(showCompleted).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(showCompleted);
    expect(screen.getByText("Design folio submission")).toBeInTheDocument();
    expect(screen.getByText(/active · 1 completed/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide completed" }),
    ).toHaveAttribute("aria-pressed", "true");

    firstRender.unmount();
    renderAssignments();
    expect(screen.getByText("Design folio submission")).toBeInTheDocument();
  });
});
