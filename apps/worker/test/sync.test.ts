import type { OrganatoItem } from "@organato/domain";
import { describe, expect, it } from "vitest";
import {
  calendarPatchFromEvent,
  extractCalendarNote,
  nextDeliveryAttemptAt,
  shouldAdvanceCanvasMissing,
} from "../src/sync";

const item = (overrides: Partial<OrganatoItem> = {}): OrganatoItem => ({
  id: "item-1",
  version: 1,
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
  displayName: "Read chapter",
  dueAt: "2026-07-27T06:00:00.000Z",
  dueDateLocal: null,
  dueHasExplicitTime: true,
  subjectId: null,
  priority: null,
  workingStatus: "not_started",
  completedAt: null,
  submittedAt: null,
  notesMarkdown: "",
  recurrenceRule: null,
  recurrenceSeriesId: null,
  calendarEnabled: true,
  remindersEnabled: true,
  calendarSyncState: "synced",
  calendarNote: "",
  pinned: false,
  sortRank: 0,
  archivedAt: null,
  archiveReason: null,
  sourceMissingSince: null,
  missingSyncCount: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  overrides: [],
  attachments: [],
  history: [],
  ...overrides,
});

describe("synchronization decisions", () => {
  it("does not advance Canvas disappearance for failed courses or past work", () => {
    const successful = new Set(["course-1"]);
    const now = new Date("2026-07-27T00:00:00.000Z");
    expect(
      shouldAdvanceCanvasMissing(
        {
          canvasCourseId: "course-2",
          sourceDueAt: "2026-07-28T00:00:00.000Z",
        },
        successful,
        now,
      ),
    ).toBe(false);
    expect(
      shouldAdvanceCanvasMissing(
        {
          canvasCourseId: "course-1",
          sourceDueAt: "2026-07-26T00:00:00.000Z",
        },
        successful,
        now,
      ),
    ).toBe(false);
    expect(
      shouldAdvanceCanvasMissing(
        {
          canvasCourseId: "course-1",
          sourceDueAt: "2026-07-28T00:00:00.000Z",
        },
        successful,
        now,
      ),
    ).toBe(true);
  });

  it("adopts Google all-day shape and the owner-editable note", () => {
    const patch = calendarPatchFromEvent(item(), {
      id: "event-1",
      status: "confirmed",
      summary: "Read chapters 1–2",
      description:
        "— Organato (managed) —\nTodo\n\n— Your calendar note —\nBring annotations",
      start: { date: "2026-07-30" },
    });
    expect(patch).toMatchObject({
      displayName: "Read chapters 1–2",
      dueAt: null,
      dueDateLocal: "2026-07-30",
      dueHasExplicitTime: false,
      calendarNote: "Bring annotations",
    });
    expect(extractCalendarNote("No Organato marker")).toBeUndefined();
  });

  it("caps delivery retry backoff", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    expect(nextDeliveryAttemptAt(1, now).toISOString()).toBe(
      "2026-07-27T00:05:00.000Z",
    );
    expect(nextDeliveryAttemptAt(8, now).toISOString()).toBe(
      "2026-07-27T01:00:00.000Z",
    );
  });
});
