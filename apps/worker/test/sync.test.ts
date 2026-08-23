import type { OrganatoItem } from "@organato/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calendarPatchFromEvent,
  extractCalendarNote,
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

describe("test email delivery", () => {
  it("refreshes Google authorization and sends to the configured recipient", async () => {
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
              first: async () =>
                query.includes("FROM integration_connection")
                  ? {
                      encrypted_credential: encryptedCredential,
                      metadata_json: JSON.stringify({
                        email: "owner@gmail.com",
                        recipients: ["student@school.edu.au"],
                      }),
                      status: "healthy",
                    }
                  : null,
            };
          },
        };
      },
    } as unknown as D1Database;
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
          return Response.json({ id: "gmail-message-id" });
        }
        return new Response(null, { status: 500 });
      });
    const env = {
      DB: db,
      DATA_ENCRYPTION_KEY: key,
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
    } as Env;

    await expect(sendTestEmail(env, "workspace-1")).resolves.toEqual({
      messageId: "gmail-message-id",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
