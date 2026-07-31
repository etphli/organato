import { z } from "zod";
import type {
  CanvasAssignment,
  CanvasCourse,
  CanvasIdentity,
  CanvasProvider,
  CanvasSyncResult,
} from "./contracts";

const userSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
});

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
  | "token_rejected"
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
const canvasUserAgent = "Organato/0.1 (+https://organato.vercel.app)";

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

export class CanvasRestProvider implements CanvasProvider {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    this.baseUrl = validateBaseUrl(baseUrl);
  }

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
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
            "User-Agent": canvasUserAgent,
          },
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
      if (response.status === 401 || response.status === 403) {
        throw new CanvasConnectionError(
          "token_rejected",
          "Canvas rejected the token.",
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
    const response = await this.request("/api/v1/users/self/profile", signal);
    let user: z.infer<typeof userSchema>;
    try {
      user = userSchema.parse(await this.responseJson(response));
    } catch {
      throw new CanvasConnectionError(
        "invalid_response",
        "Canvas returned an unexpected identity response.",
      );
    }
    return { id: user.id, name: user.name, hostname: this.baseUrl.hostname };
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
