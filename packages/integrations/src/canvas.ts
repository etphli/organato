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

const assignmentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  course_id: z.union([z.string(), z.number()]).transform(String),
  name: z.string(),
  due_at: z.string().nullable().optional(),
  html_url: z.string().url(),
  updated_at: z.string(),
  published: z.boolean().default(true),
  submission: z
    .object({ workflow_state: z.string().optional() })
    .nullable()
    .optional(),
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
    const successfulCourseIds: string[] = [];
    let skippedMalformedItems = malformedCourseCount;
    if (malformedCourseCount) {
      partialFailures.push({
        courseId: "course_catalogue",
        category: "malformed_course",
      });
    }

    const chunks = Array.from(
      { length: Math.ceil(courses.length / 4) },
      (_, index) => courses.slice(index * 4, index * 4 + 4),
    );
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (course) => {
          let malformedForCourse = 0;
          const rows = await this.paginated(
            `/api/v1/courses/${encodeURIComponent(course.id)}/assignments?bucket=upcoming&override_assignment_dates=true&include[]=submission&per_page=100`,
            assignmentSchema,
            signal,
            () => {
              malformedForCourse += 1;
            },
          );
          const normalized: CanvasAssignment[] = [];
          for (const row of rows) {
            const assignmentUrl = new URL(row.html_url);
            if (assignmentUrl.origin !== this.baseUrl.origin) {
              malformedForCourse += 1;
              continue;
            }
            normalized.push({
              id: String(row.id),
              courseId: String(row.course_id),
              name: row.name,
              dueAt: row.due_at ?? null,
              htmlUrl: assignmentUrl.href,
              updatedAt: row.updated_at,
              published: row.published ?? true,
              submitted: ["submitted", "graded", "pending_review"].includes(
                row.submission?.workflow_state ?? "",
              ),
            });
          }
          return { course, assignments: normalized, malformedForCourse };
        }),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          assignments.push(...result.value.assignments);
          skippedMalformedItems += result.value.malformedForCourse;
          if (result.value.malformedForCourse) {
            partialFailures.push({
              courseId: result.value.course.id,
              category: "malformed_item",
            });
          } else {
            successfulCourseIds.push(result.value.course.id);
          }
        } else {
          partialFailures.push({
            courseId: chunk[index]?.id ?? "unknown",
            category: "course_fetch_failed",
          });
        }
      });
    }
    return {
      courses,
      assignments,
      partialFailures,
      successfulCourseIds,
      catalogueComplete: malformedCourseCount === 0,
      skippedMalformedItems,
    };
  }
}

export { nextLink, validateBaseUrl };
