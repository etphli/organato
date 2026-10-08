import {
  cleanup,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { validateBackup } from "@organato/domain/backup";
import { App } from "../App";
import { seedItems, seedSettings, seedSubjects, seedViews } from "../data/seed";
import WorkPage from "../pages/WorkPage";
import HomePage from "../pages/HomePage";
import {
  buildCalendarEntries,
  defaultCalendarFilters,
} from "../pages/calendar/model";
import { useCalendarPreferences } from "../pages/calendar/useCalendarPreferences";
import { OrganatoProvider } from "../state/OrganatoProvider";

const legacyItems = seedItems
  .filter(
    (item) =>
      item.kind === "work" &&
      !item.archivedAt &&
      item.classification !== "unclassified",
  )
  .map((item) => ({
    ...item,
    workingStatus: "not_started" as const,
    completedAt: null,
    submittedAt: null,
    dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    dueDateLocal: null,
    dueHasExplicitTime: true,
  }));
const legacyView = {
  ...seedViews[0]!,
  id: "legacy-view",
  page: "checkpoints" as const,
  name: "Saved school work",
  filters: {},
};
function seed() {
  localStorage.setItem(
    "organato-demo-state-v1",
    JSON.stringify({
      items: legacyItems,
      subjects: seedSubjects,
      settings: {
        ...seedSettings,
        includeBothInPanels: false,
        upcomingAssignmentCount: 50,
      },
      views: [legacyView],
    }),
  );
}
function Location() {
  const location = useLocation();
  return (
    <output aria-label="Current route">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}
beforeEach(() => {
  localStorage.clear();
  seed();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("unified assignments", () => {
  it("shows checkpoints and Both records exactly once and keeps checkpoint saved views", () => {
    render(
      <MemoryRouter initialEntries={["/assignments?view=legacy-view"]}>
        <OrganatoProvider>
          <WorkPage />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    for (const item of legacyItems)
      expect(screen.getAllByText(item.displayName)).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: "Assignment view" })[0],
    ).toHaveTextContent(legacyView.name);
    expect(screen.queryByLabelText("Both")).toBeNull();
  });

  it("redirects legacy URLs with saved-view queries and removes checkpoint navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/checkpoints?view=legacy-view#work"]}>
        <OrganatoProvider>
          <App />
          <Location />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    await screen.findByRole(
      "heading",
      { name: "Assignments" },
      { timeout: 15_000 },
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/assignments?view=legacy-view#work",
    );
    expect(screen.queryByRole("link", { name: "Checkpoints" })).toBeNull();
  });

  it("shows one upcoming list including legacy Both work even with the old panel toggle off", () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <HomePage />
        </OrganatoProvider>
      </MemoryRouter>,
    );
    const panel = screen
      .getByRole("heading", { name: "Upcoming assignments" })
      .closest("section");
    if (!panel) throw new Error("Upcoming list did not render");
    for (const item of legacyItems)
      expect(within(panel).getAllByText(item.displayName)).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "Upcoming checkpoints" }),
    ).toBeNull();
  });

  it("includes legacy work in the Assignment calendar filter without mutating items", () => {
    const before = structuredClone(legacyItems);
    const entries = buildCalendarEntries(
      legacyItems,
      new Map(seedSubjects.map((subject) => [subject.id, subject])),
      seedSettings,
      { ...defaultCalendarFilters, types: ["assignment"] },
    );
    expect(entries.map((entry) => entry.item.id).toSorted()).toEqual(
      legacyItems.map((item) => item.id).toSorted(),
    );
    expect(entries.every((entry) => entry.type === "assignment")).toBe(true);
    expect(legacyItems).toEqual(before);
  });

  it("migrates a saved checkpoint calendar filter and retains other filters", () => {
    localStorage.setItem(
      "organato-calendar-preferences-v2",
      JSON.stringify({
        view: "agenda",
        anchorKey: "2026-10-15",
        selectedDateKey: "2026-10-15",
        filters: {
          ...defaultCalendarFilters,
          types: ["checkpoint"],
          subjectIds: ["maths"],
          priorities: ["high"],
        },
      }),
    );
    const { result } = renderHook(() =>
      useCalendarPreferences("month", "Australia/Sydney"),
    );
    expect(result.current[0]).toMatchObject({
      view: "agenda",
      anchorKey: "2026-10-15",
      filters: {
        types: ["assignment"],
        subjectIds: ["maths"],
        priorities: ["high"],
      },
    });
  });

  it("round-trips legacy item data, templates, and saved views through backup validation", () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: seedSettings,
      subjects: seedSubjects,
      items: [
        ...legacyItems,
        {
          ...legacyItems[0],
          id: "archived-legacy",
          archivedAt: new Date().toISOString(),
          archiveReason: "Saved archive",
        },
      ],
      savedViews: [legacyView],
    };
    const parsed = validateBackup(JSON.parse(JSON.stringify(backup)));
    if (!parsed.success) throw new Error(parsed.error.message);
    expect(parsed.data).toEqual(backup);
  });
});
