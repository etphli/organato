import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { OrganatoProvider } from "../state/OrganatoProvider";
import HomePage from "../pages/HomePage";
import { seedItems, seedSettings, seedSubjects } from "../data/seed";

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

    expect(screen.getByText("Future active assignment")).toBeInTheDocument();
    expect(screen.queryByText("Future completed assignment")).toBeNull();
    expect(screen.queryByText("Past completed assignment")).toBeNull();
  });
});
