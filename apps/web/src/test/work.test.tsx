import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
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

function assignmentViewButton() {
  return screen.getAllByRole("button", { name: "Assignment view" })[0]!;
}

describe("Assignment controls", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("switches between active and all assignments", () => {
    renderAssignments();

    expect(screen.getByText("Group lab report")).toBeInTheDocument();
    expect(screen.queryByText("Scene rehearsal")).not.toBeInTheDocument();

    fireEvent.click(assignmentViewButton());
    fireEvent.click(screen.getByRole("option", { name: "All assignments" }));

    expect(screen.getByText("6 items")).toBeInTheDocument();
    expect(screen.getByText("Scene rehearsal")).toBeInTheDocument();

    fireEvent.click(assignmentViewButton());
    fireEvent.click(screen.getByRole("option", { name: "All active" }));
    expect(screen.queryByText("Scene rehearsal")).not.toBeInTheDocument();
  });

  it("uses the custom date picker in the create form", () => {
    renderAssignments();

    fireEvent.click(screen.getByRole("button", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Due date" }));

    const calendar = screen.getByRole("dialog", {
      name: "Due date calendar",
    });
    expect(calendar).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "Previous month" }),
    ).toBeInTheDocument();
    expect(
      within(calendar).getByRole("button", { name: "Today" }),
    ).toBeInTheDocument();
  });

  it("deletes an assignment through the row action menu", () => {
    renderAssignments();

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Group lab report" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete assignment" }),
    );

    const confirmation = screen.getByRole("textbox", {
      name: "Type the assignment name to confirm",
    });
    const deleteButton = screen.getByRole("button", {
      name: "Delete assignment",
    });
    expect(deleteButton).toBeDisabled();

    fireEvent.change(confirmation, { target: { value: "Group lab report" } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    expect(screen.queryByText("Group lab report")).not.toBeInTheDocument();
  });
});
