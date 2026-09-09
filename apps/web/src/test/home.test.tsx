import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { OrganatoProvider } from "../state/OrganatoProvider";
import HomePage from "../pages/HomePage";
import { seedItems, seedSettings, seedSubjects } from "../data/seed";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Home", () => {
  it("keeps new Canvas work visible for classification", () => {
    localStorage.clear();
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <HomePage />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText("3 items to classify")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Both" })).toBeInTheDocument();
  });

  it("shows only unfinished future work in upcoming panels", () => {
    const template = seedItems.find(
      (item) => item.kind === "work" && item.classification === "assignment",
    )!;
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    localStorage.setItem(
      "organato-demo-state-v1",
      JSON.stringify({
        items: [
          {
            ...template,
            id: "future-active",
            displayName: "Future active assignment",
            dueAt: future,
            workingStatus: "not_started",
            completedAt: null,
          },
          {
            ...template,
            id: "future-completed",
            displayName: "Future completed assignment",
            dueAt: future,
            workingStatus: "completed",
            completedAt: new Date().toISOString(),
          },
          {
            ...template,
            id: "past-completed",
            displayName: "Past completed assignment",
            dueAt: past,
            workingStatus: "completed",
            completedAt: past,
          },
        ],
        subjects: seedSubjects,
        settings: seedSettings,
        views: [],
      }),
    );

    render(
      <MemoryRouter>
        <OrganatoProvider>
          <HomePage />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getAllByText("Future active assignment").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Future completed assignment")).toBeNull();
    expect(screen.queryByText("Past completed assignment")).toBeNull();
  });

  it("briefs the top priorities and flags deadline risks", () => {
    const template = seedItems.find(
      (item) => item.kind === "work" && item.classification === "assignment",
    )!;
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    localStorage.clear();
    localStorage.setItem(
      "organato-demo-state-v1",
      JSON.stringify({
        items: [
          {
            ...template,
            id: "overdue-risk",
            displayName: "Overdue essay",
            dueAt: past,
            workingStatus: "not_started",
            completedAt: null,
          },
          {
            ...template,
            id: "future-fine",
            displayName: "Future essay",
            dueAt: future,
            workingStatus: "not_started",
            completedAt: null,
          },
        ],
        subjects: seedSubjects,
        settings: seedSettings,
        views: [],
      }),
    );

    render(
      <MemoryRouter>
        <OrganatoProvider>
          <HomePage />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("region", { name: "Top priorities" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Overdue essay").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("region", { name: "Deadline risks" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });
});
