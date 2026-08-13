import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { OrganatoItem } from "@organato/domain";
import { seedItems, seedSettings, seedSubjects, seedViews } from "../data/seed";
import TodoPage from "../pages/TodoPage";
import { OrganatoProvider } from "../state/OrganatoProvider";

const storageKey = "organato-demo-state-v1";

function recurringDateOnlyTodo(): OrganatoItem {
  return {
    ...seedItems[0]!,
    id: "monthly-review",
    kind: "todo",
    classification: "unclassified",
    sourceType: "manual",
    canvasAssignmentId: null,
    canvasCourseId: null,
    canvasHtmlUrl: null,
    sourceName: null,
    sourceDueAt: null,
    sourceUpdatedAt: null,
    sourcePayloadHash: null,
    displayName: "Monthly review",
    dueAt: null,
    dueDateLocal: "2026-01-31",
    dueHasExplicitTime: false,
    workingStatus: "not_started",
    completedAt: null,
    recurrenceRule: {
      frequency: "monthly",
      interval: 1,
      seriesId: "monthly-review-series",
    },
    recurrenceSeriesId: "monthly-review-series",
    overrides: [],
    attachments: [],
    history: [],
  };
}

describe("todo recurrence", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        items: [recurringDateOnlyTodo()],
        subjects: seedSubjects,
        settings: seedSettings,
        views: seedViews,
      }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-30T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("completes one occurrence and creates the next date-only occurrence", () => {
    render(
      <MemoryRouter>
        <OrganatoProvider>
          <TodoPage />
        </OrganatoProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Complete Monthly review" }),
    );
    act(() => vi.advanceTimersByTime(200));

    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}") as {
      items: OrganatoItem[];
    };
    const original = saved.items.find((item) => item.id === "monthly-review");
    const next = saved.items.find((item) => item.id !== "monthly-review");

    expect(original).toMatchObject({
      workingStatus: "completed",
      dueAt: null,
      dueDateLocal: "2026-01-31",
      dueHasExplicitTime: false,
    });
    expect(next).toMatchObject({
      workingStatus: "not_started",
      dueAt: null,
      dueDateLocal: "2026-02-28",
      dueHasExplicitTime: false,
      recurrenceSeriesId: "monthly-review-series",
    });
  });
});
