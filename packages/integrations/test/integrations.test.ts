import { describe, expect, it, vi } from "vitest";
import type { OrganatoItem } from "@organato/domain";
import {
  CanvasConnectionError,
  CanvasRestProvider,
  GoogleCalendarRestProvider,
  nextLink,
  normalizeCanvasCookie,
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
      expect(new Headers(init?.headers).get("Cookie")).toBe(
        "canvas_session=private-session",
      );
      if (String(input).endsWith("/api/v1/users/self")) {
        expect(input).toBe("https://emanuel.instructure.com/api/v1/users/self");
        return new Response(JSON.stringify({ id: 1, name: "Ethan Likht" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=private-session",
      fetcher,
    );

    await expect(provider.validateConnection()).resolves.toMatchObject({
      id: "1",
      name: "Ethan Likht",
    });
  });

  it("normalizes a pasted Cookie header before sending it", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("Cookie")).toBe(
          "canvas_session=private-session",
        );
        if (String(_input).endsWith("/api/v1/users/self")) {
          return new Response(JSON.stringify({ id: 1, name: "Ethan Likht" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    ) as unknown as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      '  cookie: "canvas_session=private-session"  ',
      fetcher,
    );

    await expect(provider.validateConnection()).resolves.toMatchObject({
      id: "1",
      name: "Ethan Likht",
    });
  });

  it("keeps every cookie pair intact while normalizing", () => {
    expect(normalizeCanvasCookie("_csrf_token=a; canvas_session=b")).toBe(
      "_csrf_token=a; canvas_session=b",
    );
    expect(normalizeCanvasCookie("Cookie:\n_canvas_session=x")).toBe(
      "_canvas_session=x",
    );
  });

  it("distinguishes an expired session from denied API access", async () => {
    const expiredSessionProvider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=expired",
      (async () =>
        new Response(null, {
          status: 401,
          headers: { "WWW-Authenticate": "Bearer" },
        })) as typeof fetch,
    );
    const deniedProvider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=restricted",
      (async () => new Response(null, { status: 403 })) as typeof fetch,
    );

    await expect(
      expiredSessionProvider.validateConnection(),
    ).rejects.toMatchObject({ code: "session_rejected", status: 401 });
    await expect(deniedProvider.validateConnection()).rejects.toMatchObject({
      code: "api_access_denied",
      status: 403,
    });

    const expiredWithoutChallengeProvider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=expired",
      (async () => new Response(null, { status: 401 })) as typeof fetch,
    );
    await expect(
      expiredWithoutChallengeProvider.validateConnection(),
    ).rejects.toMatchObject({ code: "session_rejected", status: 401 });
  });

  it("falls back to the profile endpoint when the standard identity route is denied", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/users/self")) {
        return new Response(null, { status: 403 });
      }
      if (url.endsWith("/api/v1/users/self/profile")) {
        return new Response(
          JSON.stringify({ id: 1, display_name: "Ethan Likht" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/courses?")) {
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected probe: ${url}`);
    }) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=private-session",
      fetcher,
    );

    await expect(provider.validateConnection()).resolves.toMatchObject({
      id: "1",
      name: "Ethan Likht",
    });
  });

  it("accepts a token when only the course import endpoint is available", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/users/self")) {
        return new Response(null, { status: 403 });
      }
      if (url.includes("/api/v1/courses?")) {
        return new Response("[]", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected probe: ${url}`);
    }) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "canvas_session=private-session",
      fetcher,
    );

    await expect(provider.validateConnection()).resolves.toMatchObject({
      id: "self",
      name: "Canvas user",
    });
  });

  it("does not accept an identity token that cannot read courses", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/users/self")) {
        return new Response(JSON.stringify({ id: 1, name: "Ethan Likht" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/v1/courses?")) {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected probe: ${url}`);
    }) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "identity-only-token",
      fetcher,
    );

    await expect(provider.validateConnection()).rejects.toMatchObject({
      code: "api_access_denied",
      status: 403,
    });
  });

  it("does not accept a course-only token that cannot read assignments", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/users/self")) {
        return new Response(JSON.stringify({ id: 1, name: "Ethan Likht" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/v1/courses?")) {
        return new Response(JSON.stringify([{ id: 42, name: "Mathematics" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/v1/courses/42/assignments?")) {
        return new Response(null, { status: 403 });
      }
      throw new Error(`Unexpected probe: ${url}`);
    }) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "course-only-token",
      fetcher,
    );

    await expect(provider.validateConnection()).rejects.toMatchObject({
      code: "api_access_denied",
      status: 403,
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
      "canvas_session=private-session",
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
      "canvas_session=private-session",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).rejects.toMatchObject({
      code: "unexpected_origin",
    });
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
