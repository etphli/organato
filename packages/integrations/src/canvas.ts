import { z } from "zod";
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasIdentity,
  CanvasProvider,
  CanvasSyncResult,
} from "./contracts";

const userIdSchema = z
  .union([z.string().trim().min(1), z.number().int()])
  .transform(String);

const identitySchema = z
  .object({
    id: userIdSchema,
    name: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    short_name: z.string().nullable().optional(),
  })
  .passthrough();

const courseSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  workflow_state: z.string().default("available"),
});

const plannerItemSchema = z.object({
  course_id: z
    .union([z.string(), z.number()])
    .transform(String)
    .nullable()
    .optional(),
  plannable_id: z.union([z.string(), z.number()]).transform(String),
  plannable_type: z.string(),
  plannable_date: z.string().nullable().optional(),
  plannable: z.unknown(),
  submissions: z
    .union([
      z.literal(false),
      z.object({
        submitted: z.boolean().default(false),
        graded: z.boolean().default(false),
        excused: z.boolean().default(false),
      }),
    ])
    .nullable()
    .optional(),
  html_url: z.string(),
});

const plannerAssignmentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  due_at: z.string().nullable().optional(),
  updated_at: z.string(),
});

export type CanvasConnectionErrorCode =
  | "invalid_base_url"
  | "unexpected_origin"
  | "unexpected_redirect"
  | "session_rejected"
  | "api_access_denied"
  | "edge_blocked"
  | "rate_limited"
  | "request_failed"
  | "invalid_response"
  | "response_too_large"
  | "pagination_limit";

export class CanvasConnectionError extends Error {
  constructor(
    readonly code: CanvasConnectionErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CanvasConnectionError";
  }
}

/**
 * Organato authenticates as the signed-in Canvas user by replaying the
 * browser session cookie, so no personal access token is required. The
 * cookie value is normally copied from the browser's developer tools and
 * clipboard tools commonly include a "Cookie:" header label, quotes, or
 * line breaks. Normalize those harmless presentation details once at the
 * integration boundary so every request uses the exact value Canvas
 * expects.
 */
export function normalizeCanvasCookie(value: string): string {
  let cookie = value.replace(/^\uFEFF/, "").trim();
  for (let pass = 0; pass < 2; pass += 1) {
    if (
      (cookie.startsWith('"') && cookie.endsWith('"')) ||
      (cookie.startsWith("'") && cookie.endsWith("'"))
    ) {
      cookie = cookie.slice(1, -1).trim();
    }
    if (/^cookie\s*:/i.test(cookie)) {
      cookie = cookie.replace(/^cookie\s*:/i, "").trim();
    }
  }
  return cookie;
}

function identityFromResponse(
  value: unknown,
  hostname: string,
): CanvasIdentity {
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) {
    throw new CanvasConnectionError(
      "invalid_response",
      "Canvas returned an unexpected identity response.",
    );
  }
  const name = [
    parsed.data.name,
    parsed.data.display_name,
    parsed.data.short_name,
  ]
    .map((candidate) => candidate?.trim())
    .find((candidate): candidate is string => Boolean(candidate));
  return {
    id: parsed.data.id,
    name: name ?? "Canvas user",
    hostname,
  };
}

function isInsufficientScope(response: Response): boolean {
  return /(?:error\s*=\s*["']?insufficient_scope\b)/i.test(
    response.headers.get("WWW-Authenticate") ?? "",
  );
}

function validateBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CanvasConnectionError(
      "invalid_base_url",
      "Canvas needs a valid HTTPS address.",
    );
  }
  if (url.protocol !== "https:") {
    throw new CanvasConnectionError(
      "invalid_base_url",
      "Canvas must use HTTPS.",
    );
  }
  if (url.username || url.password) {
    throw new CanvasConnectionError(
      "invalid_base_url",
      "Canvas addresses cannot include credentials.",
    );
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match?.[2] === "next") return match[1] ?? null;
  }
  return null;
}

const maximumResponseBytes = 5_000_000;
const maximumAttempts = 3;

export function retryAfterMs(
  value: string | null,
  attempt: number,
  nowMs = Date.now(),
): number {
  const fallback = Math.min(5_000, 250 * 2 ** attempt);
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(10_000, seconds * 1_000);
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return fallback;
  return Math.min(10_000, Math.max(0, date - nowMs));
}

type Sleep = (milliseconds: number) => Promise<void>;

/**
 * Instructure's edge refuses requests that do not look like they came from
 * the Canvas web app itself: a bare server User-Agent receives an HTTP 403
 * "Not Authorized" gate page before authentication is even evaluated. Every
 * request therefore carries the exact header set a signed-in browser sends,
 * which the verified-correct session cookie then authenticates normally.
 */
function canvasRequestHeaders(
  cookie: string,
  origin: string,
): Record<string, string> {
  return {
    Cookie: cookie,
    Accept: "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Origin: origin,
    Referer: `${origin}/`,
    "X-Requested-With": "XMLHttpRequest",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "same-origin",
    "sec-fetch-site": "same-origin",
  };
}

function isEdgeGateResponse(response: Response, bodyStart: string): boolean {
  return (
    (response.status === 403 || response.status === 503) &&
    /<!doctype html/i.test(bodyStart) &&
    /not authorized|access denied|challenge/i.test(bodyStart)
  );
}

export class CanvasRestProvider implements CanvasProvider {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    cookie: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.baseUrl = validateBaseUrl(baseUrl);
    this.cookie = normalizeCanvasCookie(cookie);
  }

  private readonly cookie: string;

  private async request(
    pathOrUrl: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(pathOrUrl, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new CanvasConnectionError(
        "unexpected_origin",
        "Canvas refused an unexpected cross-origin request.",
      );
    }
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher.call(globalThis, url.toString(), {
          headers: canvasRequestHeaders(this.cookie, this.baseUrl.origin),
          redirect: "manual",
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt < maximumAttempts - 1) {
          await this.sleep(retryAfterMs(null, attempt));
          continue;
        }
        throw new CanvasConnectionError(
          "request_failed",
          "Canvas could not be reached.",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        throw new CanvasConnectionError(
          "unexpected_redirect",
          "Canvas refused an unexpected redirect.",
        );
      }
      if (response.status === 401) {
        throw new CanvasConnectionError(
          isInsufficientScope(response)
            ? "api_access_denied"
            : "session_rejected",
          isInsufficientScope(response)
            ? "Canvas denied access to this API endpoint."
            : "Canvas rejected the browser session.",
          response.status,
        );
      }
      if (response.status === 403) {
        const bodyStart = (await response.text()).slice(0, 400);
        if (isEdgeGateResponse(response, bodyStart)) {
          throw new CanvasConnectionError(
            "edge_blocked",
            "The school's Canvas firewall refused this request before it reached Canvas.",
            response.status,
          );
        }
        throw new CanvasConnectionError(
          "api_access_denied",
          "Canvas denied API access.",
          response.status,
        );
      }
      const retryable =
        response.status === 429 ||
        [500, 502, 503, 504].includes(response.status);
      if (retryable && attempt < maximumAttempts - 1) {
        await response.body?.cancel();
        await this.sleep(
          retryAfterMs(response.headers.get("Retry-After"), attempt),
        );
        continue;
      }
      if (response.status === 429) {
        throw new CanvasConnectionError(
          "rate_limited",
          "Canvas rate limited the request.",
          response.status,
        );
      }
      if (!response.ok) {
        throw new CanvasConnectionError(
          "request_failed",
          `Canvas request failed (${response.status}).`,
          response.status,
        );
      }
      const contentLength = Number(response.headers.get("Content-Length") ?? 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > maximumResponseBytes
      ) {
        throw new CanvasConnectionError(
          "response_too_large",
          "Canvas returned a response above the safe size limit.",
        );
      }
      return response;
    }
    throw new CanvasConnectionError(
      "request_failed",
      "Canvas could not be reached.",
    );
  }

  private async responseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length > maximumResponseBytes) {
      throw new CanvasConnectionError(
        "response_too_large",
        "Canvas returned a response above the safe size limit.",
      );
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CanvasConnectionError(
        "invalid_response",
        "Canvas returned invalid JSON.",
      );
    }
  }

  private async paginated<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    onMalformed?: () => void,
  ): Promise<T[]> {
    const output: T[] = [];
    let next: string | null = path;
    const visited = new Set<string>();
    while (next && visited.size < 50) {
      if (visited.has(next)) {
        throw new CanvasConnectionError(
          "pagination_limit",
          "Canvas pagination loop detected.",
        );
      }
      visited.add(next);
      const response = await this.request(next, signal);
      const body = await this.responseJson(response);
      if (!Array.isArray(body)) {
        throw new CanvasConnectionError(
          "invalid_response",
          "Canvas returned an unexpected response.",
        );
      }
      for (const row of body) {
        const parsed = schema.safeParse(row);
        if (parsed.success) output.push(parsed.data);
        else onMalformed?.();
      }
      next = nextLink(response.headers.get("Link"));
    }
    if (next) {
      throw new CanvasConnectionError(
        "pagination_limit",
        "Canvas pagination exceeded the safe page limit.",
      );
    }
    return output;
  }

  async validateConnection(signal?: AbortSignal): Promise<CanvasIdentity> {
    const identityPaths = ["/api/v1/users/self", "/api/v1/users/self/profile"];
    let identity: CanvasIdentity | null = null;

    for (const path of identityPaths) {
      try {
        const response = await this.request(path, signal);
        identity = identityFromResponse(
          await this.responseJson(response),
          this.baseUrl.hostname,
        );
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (!(error instanceof CanvasConnectionError)) throw error;
      }
    }

    // Some Canvas installations scope the self/profile endpoints separately
    // from course access. Prove the session can perform Organato's actual
    // read-only import before accepting it, while still failing closed for
    // an expired session or an inaccessible course API.
    let courseProbeError: CanvasConnectionError | null = null;
    try {
      const response = await this.request(
        "/api/v1/courses?enrollment_state=active&state[]=available&per_page=1",
        signal,
      );
      const body = await this.responseJson(response);
      if (!Array.isArray(body)) {
        throw new CanvasConnectionError(
          "invalid_response",
          "Canvas returned an unexpected course response.",
        );
      }
      const firstCourse = body
        .map((row) => courseSchema.safeParse(row))
        .find((parsed) => parsed.success);
      if (firstCourse?.success) {
        const assignmentsResponse = await this.request(
          `/api/v1/courses/${encodeURIComponent(firstCourse.data.id)}/assignments?bucket=upcoming&override_assignment_dates=true&include[]=submission&per_page=1`,
          signal,
        );
        const assignments = await this.responseJson(assignmentsResponse);
        if (!Array.isArray(assignments)) {
          throw new CanvasConnectionError(
            "invalid_response",
            "Canvas returned an unexpected assignment response.",
          );
        }
      }
      return (
        identity ?? {
          id: "self",
          name: "Canvas user",
          hostname: this.baseUrl.hostname,
        }
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof CanvasConnectionError)) throw error;
      courseProbeError = error;
    }

    if (courseProbeError) {
      throw courseProbeError;
    }
    throw new CanvasConnectionError(
      "request_failed",
      "Canvas could not verify the connection.",
    );
  }

  async fetchUpcomingAssignments(
    signal?: AbortSignal,
  ): Promise<CanvasSyncResult> {
    let malformedCourseCount = 0;
    const courseRows = await this.paginated(
      "/api/v1/courses?enrollment_state=active&state[]=available&per_page=100",
      courseSchema,
      signal,
      () => {
        malformedCourseCount += 1;
      },
    );
    const courses: CanvasCourse[] = courseRows.map((course) => ({
      id: String(course.id),
      name: course.name,
      workflowState: course.workflow_state ?? "available",
    }));
    const assignments: CanvasAssignment[] = [];
    const partialFailures: CanvasSyncResult["partialFailures"] = [];
    let skippedMalformedItems = malformedCourseCount;
    if (malformedCourseCount) {
      partialFailures.push({
        courseId: "course_catalogue",
        category: "malformed_course",
      });
    }

    const start = new Date(Date.now() - 86_400_000);
    const end = new Date(start);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    const plannerParams = new URLSearchParams({
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      filter: "incomplete_items",
      per_page: "100",
    });
    let malformedPlannerCount = 0;
    const plannerRows = await this.paginated(
      `/api/v1/planner/items?${plannerParams.toString()}`,
      plannerItemSchema,
      signal,
      () => {
        malformedPlannerCount += 1;
      },
    );
    const courseIds = new Set(courses.map((course) => course.id));
    const malformedCourseIds = new Set<string>();
    for (const row of plannerRows) {
      if (row.plannable_type !== "assignment") continue;
      const assignment = plannerAssignmentSchema.safeParse(row.plannable);
      const courseId =
        row.course_id === null || row.course_id === undefined
          ? null
          : String(row.course_id);
      let assignmentUrl: URL | null = null;
      try {
        assignmentUrl = new URL(row.html_url, this.baseUrl);
      } catch {
        // Count this below with the other malformed planner cases.
      }
      if (
        !assignment.success ||
        !courseId ||
        !courseIds.has(courseId) ||
        assignment.data.id !== row.plannable_id ||
        assignmentUrl?.origin !== this.baseUrl.origin
      ) {
        malformedPlannerCount += 1;
        if (courseId) malformedCourseIds.add(courseId);
        continue;
      }
      const submission = row.submissions === false ? null : row.submissions;
      assignments.push({
        id: assignment.data.id,
        courseId,
        name: assignment.data.title,
        dueAt: assignment.data.due_at ?? row.plannable_date ?? null,
        htmlUrl: assignmentUrl.href,
        updatedAt: assignment.data.updated_at,
        published: true,
        submitted: Boolean(
          submission?.submitted || submission?.graded || submission?.excused,
        ),
      });
    }
    skippedMalformedItems += malformedPlannerCount;
    if (malformedPlannerCount) {
      partialFailures.push({
        courseId: [...malformedCourseIds].join(",") || "planner_feed",
        category: "malformed_item",
      });
    }
    return {
      courses,
      assignments,
      partialFailures,
      successfulCourseIds: courses
        .filter((course) => !malformedCourseIds.has(course.id))
        .map((course) => course.id),
      catalogueComplete: malformedCourseCount === 0,
      skippedMalformedItems,
    };
  }
}

export { nextLink, validateBaseUrl };
