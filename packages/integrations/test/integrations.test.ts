import { describe, expect, it, vi } from "vitest";
import type { OrganatoItem } from "@organato/domain";
import {
  CanvasConnectionError,
  CanvasRestProvider,
  GoogleCalendarRestProvider,
  nextLink,
  projectCalendarEvent,
  validateBaseUrl,
} from "../src";

function item(overrides: Partial<OrganatoItem> = {}): OrganatoItem {
  return {
    id: "item-1",
    version: 4,
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
    dueAt: null,
    dueDateLocal: "2026-07-31",
    dueHasExplicitTime: false,
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
  };
}

describe("Canvas network boundaries", () => {
  it("passes a plain URL string to the runtime fetch implementation", async () => {
    const fetcher = vi.fn(async function (
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      expect(typeof input).toBe("string");
      expect(new Headers(init?.headers).get("User-Agent")).toBe(
        "Organato/0.1 (+https://organato.vercel.app)",
      );
      return new Response(JSON.stringify({ id: 1, name: "Ethan Likht" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.validateConnection()).resolves.toMatchObject({
      id: "1",
      name: "Ethan Likht",
    });
  });

  it("requires HTTPS", () => {
    expect(() => validateBaseUrl("http://canvas.example.edu")).toThrow(/HTTPS/);
  });

  it("canonicalizes Canvas links to one origin", () => {
    expect(
      validateBaseUrl(
        "https://EMANUEL.instructure.com/courses/42?module=work#today",
      ).href,
    ).toBe("https://emanuel.instructure.com/");
  });

  it("rejects credentials embedded in a Canvas address", () => {
    expect(() =>
      validateBaseUrl("https://token@emanuel.instructure.com"),
    ).toThrow(/credentials/);
  });

  it("reads the Canvas Link next relation", () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next", <https://canvas.example.edu/api/v1/courses?page=4>; rel="last"';
    expect(nextLink(header)).toContain("page=2");
  });

  it("never follows pagination to another origin", async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify([
          { id: 1, name: "English", workflow_state: "available" },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://attacker.example/api/v1/courses?page=2>; rel="next"',
          },
        },
      )) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).rejects.toMatchObject({
      name: "CanvasConnectionError",
      code: "unexpected_origin",
    } satisfies Partial<CanvasConnectionError>);
  });

  it("treats another port as another origin", async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify([
          { id: 1, name: "English", workflow_state: "available" },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://emanuel.instructure.com:8443/api/v1/courses?page=2>; rel="next"',
          },
        },
      )) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).rejects.toMatchObject({
      code: "unexpected_origin",
    });
  });

  it("imports the personalized incomplete assignments shown in Canvas Planner", async () => {
    const requestedPaths: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedPaths.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/api/v1/courses") {
        return new Response(
          JSON.stringify([
            { id: 12, name: "English", workflow_state: "available" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      expect(url.pathname).toBe("/api/v1/planner/items");
      expect(url.searchParams.get("filter")).toBe("incomplete_items");
      expect(url.searchParams.get("start_date")).toBeTruthy();
      expect(url.searchParams.get("end_date")).toBeTruthy();
      return new Response(
        JSON.stringify([
          {
            course_id: 12,
            plannable_id: 101,
            plannable_type: "assignment",
            plannable_date: "2026-08-15T06:00:00Z",
            plannable: {
              id: 101,
              title: "Comparative essay draft",
              due_at: "2026-08-15T06:00:00Z",
              updated_at: "2026-07-30T00:10:00Z",
            },
            submissions: { submitted: false, graded: false, excused: false },
            html_url: "/courses/12/assignments/101",
          },
          {
            course_id: 12,
            plannable_id: 202,
            plannable_type: "calendar_event",
            plannable_date: "2026-08-16T06:00:00Z",
            plannable: {},
            submissions: false,
            html_url: "/calendar?event_id=202",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).resolves.toMatchObject({
      assignments: [
        {
          id: "101",
          courseId: "12",
          name: "Comparative essay draft",
          dueAt: "2026-08-15T06:00:00Z",
          htmlUrl: "https://emanuel.instructure.com/courses/12/assignments/101",
          updatedAt: "2026-07-30T00:10:00Z",
          published: true,
          submitted: false,
        },
      ],
      successfulCourseIds: ["12"],
      skippedMalformedItems: 0,
    });
    expect(requestedPaths).toHaveLength(2);
    expect(
      requestedPaths.some((path) => path.includes("bucket=upcoming")),
    ).toBe(false);
  });
});

describe("Google Calendar projections", () => {
  it("uses the redirect mode supported by Cloudflare Workers", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(JSON.stringify({ id: "organato-calendar" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;
    const provider = new GoogleCalendarRestProvider(
      { accessToken: async () => "access-token" },
      fetcher,
    );

    await expect(provider.ensureOrganatoCalendar()).resolves.toBe(
      "organato-calendar",
    );
  });

  it("projects a date-only deadline as an exclusive all-day range", () => {
    const projection = projectCalendarEvent(
      item(),
      undefined,
      "https://organato.example",
    );

    expect(projection).toMatchObject({
      start: { date: "2026-07-31" },
      end: { date: "2026-08-01" },
      privateProperties: {
        organatoItemId: "item-1",
        organatoItemVersion: "4",
      },
    });
    expect(projection?.start).not.toHaveProperty("dateTime");
    expect(projection?.description).not.toContain("11:59");
  });

  it("keeps timed projections as instants with a bounded end", () => {
    const projection = projectCalendarEvent(
      item({
        dueAt: "2026-07-31T06:00:00.000Z",
        dueDateLocal: null,
        dueHasExplicitTime: true,
      }),
      undefined,
      "https://organato.example",
    );

    expect(projection).toMatchObject({
      start: {
        dateTime: "2026-07-31T06:00:00.000Z",
        timeZone: "Australia/Sydney",
      },
      end: {
        dateTime: "2026-07-31T06:30:00.000Z",
        timeZone: "Australia/Sydney",
      },
    });
  });

  it("does not project archived or calendar-suppressed items", () => {
    expect(
      projectCalendarEvent(
        item({ archivedAt: "2026-07-30T00:00:00.000Z" }),
        undefined,
        "https://organato.example",
      ),
    ).toBeNull();
    expect(
      projectCalendarEvent(
        item({ calendarEnabled: false }),
        undefined,
        "https://organato.example",
      ),
    ).toBeNull();
  });
});
