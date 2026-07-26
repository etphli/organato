import { describe, expect, it } from "vitest";
import {
  assertSecretFreeBackup,
  dateOnlyCutoffUtc,
  daysBetweenLocalDates,
  digestDeliveryKey,
  groupDigestItems,
  isInView,
  nextRecurrence,
  visibleStatus,
  type OrganatoItem,
} from "../src";

const item = (overrides: Partial<OrganatoItem> = {}): OrganatoItem => ({
  id: "item-1",
  version: 1,
  kind: "work",
  classification: "assignment",
  sourceType: "manual",
  canvasAssignmentId: null,
  canvasCourseId: null,
  canvasHtmlUrl: null,
  sourceName: null,
  sourceDueAt: null,
  sourceUpdatedAt: null,
  sourcePayloadHash: null,
  displayName: "Essay",
  dueAt: "2026-07-27T06:00:00.000Z",
  dueDateLocal: null,
  dueHasExplicitTime: true,
  subjectId: "english",
  priority: null,
  workingStatus: "not_started",
  completedAt: null,
  submittedAt: null,
  notesMarkdown: "",
  recurrenceRule: null,
  recurrenceSeriesId: null,
  calendarEnabled: true,
  remindersEnabled: true,
  calendarSyncState: "pending",
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

describe("domain invariants", () => {
  it("keeps Both membership in both views", () => {
    expect(isInView("both", "assignments")).toBe(true);
    expect(isInView("both", "checkpoints")).toBe(true);
  });

  it("derives overdue without overwriting working status", () => {
    const work = item({ dueAt: "2026-07-20T00:00:00.000Z" });
    expect(visibleStatus(work, new Date("2026-07-25T00:00:00.000Z"))).toBe(
      "overdue",
    );
    expect(work.workingStatus).toBe("not_started");
  });

  it("uses Sydney calendar dates across offsets", () => {
    const from = new Date("2026-10-03T16:00:00.000Z");
    const to = new Date("2026-10-04T16:00:00.000Z");
    expect(daysBetweenLocalDates(from, to)).toBe(1);
  });

  it("treats a date-only deadline as Sydney 11:59 PM", () => {
    expect(dateOnlyCutoffUtc("2026-07-25").toISOString()).toBe(
      "2026-07-25T13:59:00.000Z",
    );
  });

  it("generates only the next recurring occurrence", () => {
    const next = nextRecurrence(new Date("2026-07-24T06:00:00.000Z"), {
      frequency: "weekdays",
      interval: 1,
      seriesId: "series-1",
    });
    expect(next.toISOString()).toBe("2026-07-27T06:00:00.000Z");
  });

  it("deduplicates daily delivery keys by sorted normalized recipients", () => {
    expect(
      digestDeliveryKey("2026-07-25", ["B@example.com", "a@example.com"]),
    ).toBe("daily:2026-07-25:a@example.com,b@example.com");
  });

  it("groups incomplete due work and excludes completed work", () => {
    const now = new Date("2026-07-25T00:00:00.000Z");
    const groups = groupDigestItems(
      [item(), item({ id: "done", workingStatus: "completed" })],
      now,
    );
    expect(
      groups.flatMap((group) => group.items).map((entry) => entry.id),
    ).toEqual(["item-1"]);
  });

  it("detects credential-like fields in backup output", () => {
    expect(assertSecretFreeBackup('{"items":[]}')).toBe(true);
    expect(assertSecretFreeBackup('{"refresh_token":"nope"}')).toBe(false);
  });
});
