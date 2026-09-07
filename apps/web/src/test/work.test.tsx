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
import { seedItems, seedSettings, seedSubjects } from "../data/seed";

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

  it("closes the mobile actions menu when it opens filters", () => {
    renderAssignments();

    const summary = screen.getByLabelText("More page actions");
    const menu = summary.closest("details");
    expect(menu).not.toBeNull();
    menu!.open = true;

    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));

    expect(menu).not.toHaveAttribute("open");
    expect(
      screen.getByRole("textbox", { name: "Filter this view" }),
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

  it("keeps large assignment lists bounded and paginated", () => {
    const template = seedItems.find(
      (item) =>
        item.kind === "work" &&
        item.classification === "assignment" &&
        item.workingStatus === "not_started",
    )!;
    const items = Array.from({ length: 2_000 }, (_, index) => ({
      ...template,
      id: `large-assignment-${index + 1}`,
      canvasAssignmentId: `canvas-large-assignment-${index + 1}`,
      displayName: `Large assignment ${String(index + 1).padStart(3, "0")}`,
      sourceName: `Large assignment ${String(index + 1).padStart(3, "0")}`,
      history: [],
    }));
    localStorage.setItem(
      "organato-demo-state-v1",
      JSON.stringify({
        items,
        subjects: seedSubjects,
        settings: seedSettings,
        views: [],
      }),
    );

    renderAssignments();

    expect(screen.getByText("1–50 of 2000")).toBeInTheDocument();
    expect(screen.getByText("Large assignment 001")).toBeInTheDocument();
    expect(screen.queryByText("Large assignment 051")).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(51);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("51–100 of 2000")).toBeInTheDocument();
    expect(screen.getByText("Large assignment 051")).toBeInTheDocument();
    expect(screen.queryByText("Large assignment 001")).not.toBeInTheDocument();
  });
});
