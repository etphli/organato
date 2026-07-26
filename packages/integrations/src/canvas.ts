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
  | "request_failed"
  | "invalid_response"
  | "pagination_limit";

export class CanvasConnectionError extends Error {
  constructor(
    readonly code: CanvasConnectionErrorCode,
    message: string,
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

export class CanvasRestProvider implements CanvasProvider {
  readonly baseUrl: URL;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
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
    const response = await this.fetcher(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      },
      redirect: "manual",
      ...(signal ? { signal } : {}),
    });
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
    if (!response.ok) {
      throw new CanvasConnectionError(
        "request_failed",
        `Canvas request failed (${response.status}).`,
      );
    }
    return response;
  }

  private async paginated<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const output: T[] = [];
    let next: string | null = path;
    const visited = new Set<string>();
    while (next && visited.size < 50) {
      if (visited.has(next))
        throw new Error("Canvas pagination loop detected.");
      visited.add(next);
      const response = await this.request(next, signal);
      let body: T[];
      try {
        body = z.array(schema).parse(await response.json());
      } catch {
        throw new CanvasConnectionError(
          "invalid_response",
          "Canvas returned an unexpected response.",
        );
      }
      output.push(...body);
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
      user = userSchema.parse(await response.json());
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
    const courseRows = await this.paginated(
      "/api/v1/courses?enrollment_state=active&state[]=available&per_page=100",
      courseSchema,
      signal,
    );
    const courses: CanvasCourse[] = courseRows.map((course) => ({
      id: String(course.id),
      name: course.name,
      workflowState: course.workflow_state ?? "available",
    }));
    const assignments: CanvasAssignment[] = [];
    const partialFailures: CanvasSyncResult["partialFailures"] = [];

    const chunks = Array.from(
      { length: Math.ceil(courses.length / 4) },
      (_, index) => courses.slice(index * 4, index * 4 + 4),
    );
    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (course) => {
          const rows = await this.paginated(
            `/api/v1/courses/${encodeURIComponent(course.id)}/assignments?bucket=upcoming&override_assignment_dates=true&include[]=submission&per_page=100`,
            assignmentSchema,
            signal,
          );
          return rows.map((row): CanvasAssignment => ({
            id: String(row.id),
            courseId: String(row.course_id),
            name: row.name,
            dueAt: row.due_at ?? null,
            htmlUrl: row.html_url,
            updatedAt: row.updated_at,
            published: row.published ?? true,
            submitted: ["submitted", "graded", "pending_review"].includes(
              row.submission?.workflow_state ?? "",
            ),
          }));
        }),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") assignments.push(...result.value);
        else {
          partialFailures.push({
            courseId: chunk[index]?.id ?? "unknown",
            category: "course_fetch_failed",
          });
        }
      });
    }
    return { courses, assignments, partialFailures };
  }
}

export { nextLink, validateBaseUrl };
