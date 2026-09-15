import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { seedItems, seedSettings, seedSubjects } from "../data/seed";
import CalendarPage from "../pages/CalendarPage";
import {
  buildCalendarEntries,
  defaultCalendarFilters,
  localDateTimeToIso,
  monthDates,
  rescheduleEntry,
} from "../pages/calendar/model";
import { OrganatoProvider } from "../state/OrganatoProvider";

function renderCalendar(initialEntry = "/calendar") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OrganatoProvider>
        <CalendarPage />
      </OrganatoProvider>
    </MemoryRouter>,
  );
}

describe("Calendar", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T02:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("creates a date-only todo only after confirmation", () => {
    renderCalendar();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add todo on 26 July",
      }),
    );
    expect(
      screen.getByRole("dialog", { name: "New todo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Draft outline/ })).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Todo title" }), {
      target: { value: "Draft outline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create todo" }));

    expect(screen.queryByRole("dialog", { name: "New todo" })).toBeNull();
    expect(
      screen.getAllByRole("button", {
        name: /Draft outline, All day, no subject, Todo, pending/,
      }),
    ).not.toHaveLength(0);
  }, 30_000);

  it("renders a real week surface and gives agenda navigation a range", () => {
    renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(screen.getByLabelText("Week calendar")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Add timed todo on/ }),
    ).toHaveLength(7);

    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("August 2026 agenda")).toBeInTheDocument();
  });

  it("persists the selected view and anchor on the device", () => {
    const first = renderCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
    fireEvent.click(screen.getByRole("button", { name: "Next period" }));
    first.unmount();

    renderCalendar();
    expect(screen.getByRole("button", { name: "Agenda" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("August 2026 agenda")).toBeInTheDocument();
  });

  it("opens the date requested by a Home calendar link", () => {
    renderCalendar("/calendar?date=2026-08-24");

    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Monday 24 August 2026/,
      }),
    ).toHaveAttribute("tabindex", "0");
  });
});

describe("calendar model", () => {
  it("keeps date-only items visible and timezone-correct", () => {
    const dateOnly = {
      ...seedItems[0]!,
      id: "date-only",
      displayName: "Date-only work",
      classification: "assignment" as const,
      dueAt: null,
      dueDateLocal: "2026-07-30",
      dueHasExplicitTime: false,
      workingStatus: "not_started" as const,
      completedAt: null,
    };
    const timed = {
      ...seedItems[1]!,
      id: "timed",
      dueAt: "2026-07-25T14:30:00.000Z",
      dueDateLocal: null,
      dueHasExplicitTime: true,
    };
    const subjects = new Map(
      seedSubjects.map((subject) => [subject.id, subject]),
    );
    const entries = buildCalendarEntries(
      [dateOnly, timed],
      subjects,
      seedSettings,
      defaultCalendarFilters,
      new Date("2026-07-26T02:00:00.000Z"),
    );

    expect(entries[0]).toMatchObject({
      dateKey: "2026-07-26",
      startMinutes: 30,
      isAllDay: false,
    });
    expect(entries[1]).toMatchObject({
      dateKey: "2026-07-30",
      isAllDay: true,
      timeLabel: "All day",
    });
    expect(
      rescheduleEntry(entries[1]!, "2026-08-02", "Australia/Sydney"),
    ).toMatchObject({
      dueAt: null,
      dueDateLocal: "2026-08-02",
      dueHasExplicitTime: false,
    });
    expect(localDateTimeToIso("2026-07-26", "09:00", "Australia/Sydney")).toBe(
      "2026-07-25T23:00:00.000Z",
    );
    const july = monthDates("2026-07-26", 1);
    expect(july).toHaveLength(35);
    expect(july[0]?.getDate()).toBe(29);
    expect(july.at(-1)?.getDate()).toBe(2);
  });
});
