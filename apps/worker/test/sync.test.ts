import type { OrganatoItem } from "@organato/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarPatchFromEvent,
  extractCalendarNote,
  isCanvasImportCandidate,
  nextDeliveryAttemptAt,
  sendTestEmail,
  shouldAdvanceCanvasMissing,
} from "../src/sync";
import { encryptSecret } from "../src/security";
import type { Env } from "../src/types";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("synchronization decisions", () => {
  it("imports submitted Canvas assignments instead of archiving them", () => {
    // Submitted work disappears from the incomplete_items planner feed, so
    // it must remain an import candidate (via complete_items) and never be
    // mistaken for deleted work.
    expect(
      isCanvasImportCandidate({
        id: "101",
        courseId: "12",
        name: "Comparative essay draft",
        dueAt: "2026-07-20T06:00:00.000Z",
        htmlUrl: "https://emanuel.instructure.com/courses/12/assignments/101",
        updatedAt: "2026-07-26T00:10:00.000Z",
        published: true,
        submitted: true,
      }),
    ).toBe(true);
    expect(
      isCanvasImportCandidate({
        id: "102",
        courseId: "12",
        name: "Unpublished draft",
        dueAt: null,
        htmlUrl: "https://emanuel.instructure.com/courses/12/assignments/102",
        updatedAt: "2026-07-26T00:10:00.000Z",
        published: false,
        submitted: false,
      }),
    ).toBe(false);
  });

  it("imports overdue published work even when it has not been submitted", () => {
    expect(
      isCanvasImportCandidate({
        id: "overdue",
        courseId: "12",
        name: "Overdue checkpoint",
        dueAt: "2020-01-01T00:00:00Z",
        updatedAt: "2020-01-01T00:00:00Z",
        htmlUrl: "https://canvas.example/courses/12/assignments/overdue",
        published: true,
        submitted: false,
      }),
    ).toBe(true);
  });

  it.each([
    {
      name: "future",
      dueAt: "2026-10-20T00:00:00Z",
      published: true,
      expected: true,
    },
    {
      name: "current instant",
      dueAt: "2026-10-19T00:00:00Z",
      published: true,
      expected: true,
    },
    {
      name: "past",
      dueAt: "2026-10-18T00:00:00Z",
      published: true,
      expected: false,
    },
    { name: "undated", dueAt: null, published: true, expected: false },
    {
      name: "invalid deadline",
      dueAt: "not-a-date",
      published: true,
      expected: false,
    },
    {
      name: "unpublished",
      dueAt: "2026-10-20T00:00:00Z",
      published: false,
      expected: false,
    },
  ])(
    "preserves upcoming-only import scope for $name work",
    ({ dueAt, published, expected }) => {
      expect(
        isCanvasImportCandidate(
          {
            id: "scope-check",
            courseId: "12",
            name: "Scope check",
            dueAt,
            htmlUrl:
              "https://canvas.example/courses/12/assignments/scope-check",
            updatedAt: "2026-10-19T00:00:00Z",
            published,
            submitted: false,
          },
          { upcomingOnly: true, now: new Date("2026-10-19T00:00:00Z") },
        ),
      ).toBe(expected);
    },
  );

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

describe("test email delivery", () => {
  it("sends the real reminder digest to the configured recipient", async () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const key = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const encryptedCredential = await encryptSecret(
      "refresh-token",
      key,
      "integration:google:owner@gmail.com",
    );
    const db = {
      prepare(query: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (
                  query.includes("FROM integration_connection") &&
                  !query.includes("provider IN")
                ) {
                  return {
                    encrypted_credential: encryptedCredential,
                    metadata_json: JSON.stringify({
                      email: "owner@gmail.com",
                      recipients: ["student@school.edu.au"],
                    }),
                    status: "healthy",
                  };
                }
                if (query.includes("FROM workspace")) {
                  return {
                    settings_json: JSON.stringify({
                      timezone: "Australia/Sydney",
                    }),
                  };
                }
                return null;
              },
              all: async () => ({
                results: query.includes("FROM subject")
                  ? [
                      {
                        id: "subject-1",
                        workspace_id: "workspace-1",
                        canvas_course_id: null,
                        source_name: null,
                        display_name: "English",
                        short_name: null,
                        colour: "#a78bfa",
                        active: 1,
                      },
                    ]
                  : query.includes("FROM item_history")
                    ? []
                    : [
                        {
                          provider: "canvas",
                          last_success_at: "2026-07-26T23:00:00.000Z",
                        },
                        {
                          provider: "google",
                          last_success_at: "2026-07-26T23:30:00.000Z",
                        },
                      ],
                success: true,
                meta: { changes: 0 },
              }),
            };
          },
        };
      },
      async batch() {
        return [
          {
            results: [
              {
                id: "item-1",
                workspace_id: "workspace-1",
                version: 1,
                kind: "work",
                classification: "assignment",
                source_type: "manual",
                canvas_assignment_id: null,
                canvas_course_id: null,
                canvas_html_url: null,
                source_name: null,
                source_due_at: null,
                source_updated_at: null,
                source_payload_hash: null,
                display_name: "English essay",
                due_at: "2026-07-28T06:00:00.000Z",
                due_date_local: null,
                due_has_explicit_time: 1,
                subject_id: "subject-1",
                priority: "high",
                working_status: "not_started",
                completed_at: null,
                submitted_at: null,
                notes_markdown: "",
                recurrence_rule_json: null,
                recurrence_series_id: null,
                calendar_enabled: 1,
                reminders_enabled: 1,
                calendar_sync_state: "synced",
                calendar_note: "",
                pinned: 0,
                sort_rank: 0,
                archived_at: null,
                archive_reason: null,
                source_missing_since: null,
                missing_sync_count: 0,
                created_at: "2026-07-20T00:00:00.000Z",
                updated_at: "2026-07-20T00:00:00.000Z",
              },
            ],
            success: true,
            meta: { changes: 0 },
          },
          { results: [], success: true, meta: { changes: 0 } },
        ];
      },
    } as unknown as D1Database;
    let sentMime = "";
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({
            access_token: "access-token",
            expires_in: 3600,
          });
        }
        if (url.includes("gmail.googleapis.com")) {
          const request = JSON.parse(String(init?.body)) as { raw?: string };
          expect(request.raw).toBeTruthy();
          const encoded = request
            .raw!.replaceAll("-", "+")
            .replaceAll("_", "/");
          const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
          const binary = atob(padded);
          sentMime = new TextDecoder().decode(
            Uint8Array.from(binary, (character) => character.charCodeAt(0)),
          );
          return Response.json({ id: "gmail-message-id" });
        }
        return new Response(null, { status: 500 });
      });
    const env = {
      DB: db,
      DATA_ENCRYPTION_KEY: key,
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      APP_ORIGIN: "https://organato.example",
    } as Env;

    await expect(sendTestEmail(env, "workspace-1", now)).resolves.toEqual({
      messageId: "gmail-message-id",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sentMime).toContain("Subject: Organato: 1 coming up this week");
    expect(sentMime).toContain("Weekly plan");
    expect(sentMime).toContain("English essay");
    expect(sentMime).toContain("English");
    expect(sentMime).not.toContain("Organato email is ready");
    expect(sentMime).not.toContain("Subject: Organato: test delivery");
  });
});
