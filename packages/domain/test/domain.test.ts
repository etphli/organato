import { describe, expect, it } from "vitest";
import {
  assertSecretFreeBackup,
  dateOnlyCutoffUtc,
  daysBetweenLocalDates,
  digestDeliveryKey,
  groupDigestItems,
  isInView,
  mergeDeadlineFields,
  nextRecurrence,
  nextRecurrenceDeadline,
  validateBackupItem,
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
  estimatedMinutes: null,
  archivedAt: null,
  archiveReason: null,
  sourceMissingSince: null,
  missingSyncCount: 0,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
  overrides: [],
  attachments: [],
  history: [],
  subtasks: [],
  links: { blockedBy: [], blocking: [] },
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

  it("keeps date-only recurrences date-only across month boundaries", () => {
    expect(
      nextRecurrenceDeadline(
        {
          dueAt: null,
          dueDateLocal: "2026-07-31",
          dueHasExplicitTime: false,
        },
        { frequency: "monthly", interval: 1, seriesId: "series-1" },
      ),
    ).toEqual({
      dueAt: null,
      dueDateLocal: "2026-08-31",
      dueHasExplicitTime: false,
    });
    expect(
      nextRecurrenceDeadline(
        {
          dueAt: null,
          dueDateLocal: "2026-01-31",
          dueHasExplicitTime: false,
        },
        { frequency: "monthly", interval: 1, seriesId: "series-1" },
      ),
    ).toEqual({
      dueAt: null,
      dueDateLocal: "2026-02-28",
      dueHasExplicitTime: false,
    });
  });

  it("normalizes deadline patches into one coherent representation", () => {
    expect(
      mergeDeadlineFields(
        {
          dueAt: "2026-07-27T06:00:00.000Z",
          dueDateLocal: null,
          dueHasExplicitTime: true,
        },
        { dueDateLocal: "2026-07-30" },
      ),
    ).toEqual({
      dueAt: null,
      dueDateLocal: "2026-07-30",
      dueHasExplicitTime: false,
    });
    expect(
      mergeDeadlineFields(
        {
          dueAt: null,
          dueDateLocal: "2026-07-30",
          dueHasExplicitTime: false,
        },
        { dueAt: "2026-07-30T06:00:00.000Z" },
      ),
    ).toEqual({
      dueAt: "2026-07-30T06:00:00.000Z",
      dueDateLocal: null,
      dueHasExplicitTime: true,
    });
  });

  it("rejects contradictory or impossible deadline shapes", () => {
    expect(() =>
      mergeDeadlineFields(
        {
          dueAt: null,
          dueDateLocal: null,
          dueHasExplicitTime: false,
        },
        {
          dueAt: "2026-07-30T06:00:00.000Z",
          dueHasExplicitTime: false,
        },
      ),
    ).toThrow(/explicit time/i);
    expect(() =>
      mergeDeadlineFields(
        {
          dueAt: null,
          dueDateLocal: null,
          dueHasExplicitTime: false,
        },
        { dueDateLocal: "2026-02-30" },
      ),
    ).toThrow(/invalid/i);
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

  it("rejects dangerous Canvas links and invalid date shapes in backups", () => {
    // Any https host is accepted (the server recomputes Canvas identity per
    // installation on restore), but non-https and credentialed URLs are not.
    expect(
      validateBackupItem(
        item({
          sourceType: "canvas",
          canvasAssignmentId: "42",
          canvasCourseId: "7",
          canvasHtmlUrl:
            "https://other-school.instructure.com/courses/7/assignments/42",
        }),
      ).success,
    ).toBe(true);
    expect(
      validateBackupItem(
        item({
          sourceType: "canvas",
          canvasAssignmentId: "42",
          canvasCourseId: "7",
          canvasHtmlUrl: "javascript:alert(1)",
        }),
      ).success,
    ).toBe(false);
    expect(
      validateBackupItem(
        item({
          sourceType: "canvas",
          canvasAssignmentId: "42",
          canvasCourseId: "7",
          canvasHtmlUrl: "https://user:pass@attacker.example/courses/7",
        }),
      ).success,
    ).toBe(false);
    expect(
      validateBackupItem(
        item({
          dueAt: null,
          dueDateLocal: "2026-02-30",
          dueHasExplicitTime: false,
        }),
      ).success,
    ).toBe(false);
  });
});
