import { z } from "zod";

export const connectorIdentitySchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(300),
    hostname: z.string().min(1).max(253),
  })
  .strict();
const id = z.string().min(1).max(100);
export const connectorDataSchema = z
  .object({
    courses: z
      .array(
        z
          .object({
            id,
            name: z.string().min(1).max(1000),
            workflowState: z.string().max(100),
          })
          .strict(),
      )
      .max(200),
    assignments: z
      .array(
        z
          .object({
            id,
            courseId: id,
            name: z.string().min(1).max(1000),
            dueAt: z.string().datetime().nullable(),
            htmlUrl: z.string().url().max(2000),
            updatedAt: z.string().datetime(),
            published: z.boolean(),
            submitted: z.boolean(),
          })
          .strict(),
      )
      .max(2000),
    partialFailures: z
      .array(z.object({ courseId: id, category: z.string().max(100) }).strict())
      .max(201),
    successfulCourseIds: z.array(id).max(200),
    catalogueComplete: z.boolean(),
    skippedMalformedItems: z.number().int().min(0).max(100000),
  })
  .strict()
  .superRefine((data, ctx) => {
    const courses = new Set(data.courses.map((c) => c.id));
    const success = new Set(data.successfulCourseIds);
    if (
      courses.size !== data.courses.length ||
      success.size !== data.successfulCourseIds.length ||
      new Set(data.assignments.map((a) => a.id)).size !==
        data.assignments.length ||
      data.assignments.some((a) => !courses.has(a.courseId)) ||
      data.successfulCourseIds.some((c) => !courses.has(c)) ||
      data.partialFailures.some((f) => success.has(f.courseId)) ||
      data.courses.some(
        (c) =>
          !success.has(c.id) &&
          !data.partialFailures.some((f) => f.courseId === c.id),
      ) ||
      (!data.catalogueComplete && !data.partialFailures.length) ||
      (data.skippedMalformedItems > 0 && !data.partialFailures.length)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete or inconsistent Canvas result.",
      });
    }
  });
export const connectorResultSchema = z.discriminatedUnion("status", [
  z.object({ commandId: id, status: z.literal("login_ready") }).strict(),
  z
    .object({
      commandId: id,
      status: z.literal("identity"),
      identity: connectorIdentitySchema,
    })
    .strict(),
  z
    .object({
      commandId: id,
      status: z.literal("sync"),
      identity: connectorIdentitySchema,
      data: connectorDataSchema,
    })
    .strict(),
  z
    .object({
      commandId: id,
      status: z.literal("error"),
      error: z.enum(["login_required", "network_error", "read_failed"]),
      diagnostic: z
        .enum([
          "profile_in_use",
          "display_unavailable",
          "browser_control_blocked",
          "browser_launch_timeout",
          "browser_launch_failed",
        ])
        .optional(),
    })
    .strict(),
]);
export type ConnectorIdentity = z.infer<typeof connectorIdentitySchema>;
export type ConnectorResult = z.infer<typeof connectorResultSchema>;
export interface ConnectorCommand {
  id: string;
  kind: "login" | "verify" | "sync";
  expiresAt: string;
  canvasBaseUrl: string;
}
export interface ConnectorSession {
  id: string;
  expiresAt: string;
}
export interface ConnectorState {
  workspaceId: string;
  deviceKey: string;
  baseUrl: string;
  paired: boolean;
  deviceName: string | null;
  lastSeenAt: string | null;
  phase:
    | "ready"
    | "signing_in"
    | "awaiting_confirmation"
    | "connected"
    | "login_required"
    | "syncing"
    | "error";
  identity: ConnectorIdentity | null;
  candidateIdentity: ConnectorIdentity | null;
  lastSyncAt: string | null;
  error: string | null;
  loginSession: ConnectorSession | null;
  command: ConnectorCommand | null;
  completed: string[];
  nextSyncAt: number;
}
