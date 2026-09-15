import {
  canvasConnectorRoutes,
  canvasDeviceRoutes,
  canvasViewer,
  browserConnectorActive,
  connectorStub,
} from "./canvas-connector-routes";
export { CanvasConnector } from "./canvas-connector-object";
import { GoogleApiError } from "@organato/integrations";
import { EMAIL_TEMPLATE_VERSION } from "@organato/email";
import { Hono } from "hono";
import { apiRoutes } from "./api";
import { authRoutes } from "./auth";
import {
  googleIntegrationCallback,
  googleIntegrationRoutes,
} from "./google-auth";
import {
  canvasConnectionErrorCode,
  safeCanvasConnectionError,
} from "./canvas-connection";
import { GoogleConnectionError } from "./google-connection";
import {
  isDemoMode,
  rateLimit,
  recordSecurityEvent,
  requireRecentSession,
  requireSession,
  securityHeaders,
} from "./security";
import { drainStorageDeletions } from "./storage-cleanup";
import {
  DigestPreviewError,
  resolveCalendarConflict,
  retryDueDeliveries,
  runCalendarReconciliation,
  runCanvasSync,
  runDailyDigest,
  runEveningPreview,
  runRetentionCleanup,
  runWeeklyReview,
  retryLatestDelivery,
  sendExamEscalation,
  sendTestEmail,
  sendUrgentImport,
} from "./sync";
import { sha256, safeEqual } from "./security";
import type { Env, Variables } from "./types";
import { studatoFeedRoutes } from "./studato-feed";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function runHourlyForAllWorkspaces(env: Env) {
  const rows = await env.DB.prepare(
    `SELECT workspace_id, provider FROM integration_connection
     WHERE status <> 'disconnected' AND provider IN ('canvas', 'google')`,
  ).all<{ workspace_id: string; provider: string }>();
  const providers = new Map<string, Set<string>>();
  for (const row of rows.results) {
    const set = providers.get(row.workspace_id) ?? new Set<string>();
    set.add(row.provider);
    providers.set(row.workspace_id, set);
  }
  let canvasSynced = 0;
  let canvasFailed = 0;
  let calendarFailed = 0;
  let deliveriesRetried = 0;
  let deliveriesSent = 0;
  const failures: Array<{
    workspaceId: string;
    area: string;
    error: string;
  }> = [];
  const reportFailure = async (
    workspaceId: string,
    area: string,
    error: unknown,
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ workspaceId, area, error: message });
    console.error(
      JSON.stringify({
        level: "error",
        category: "scheduled_job_failure",
        area,
        workspaceId,
        message,
      }),
    );
    await recordSecurityEvent(
      env.DB,
      "scheduled_job_failed",
      workspaceId,
      `${area}: ${message}`.slice(0, 500),
    ).catch(() => undefined);
  };
  for (const [workspaceId, connected] of providers) {
    if (
      connected.has("canvas") &&
      !(await browserConnectorActive(env, workspaceId))
    ) {
      try {
        const result = await runCanvasSync(env, workspaceId, "scheduled");
        await sendUrgentImport(
          env,
          workspaceId,
          result.runId,
          result.createdIds,
        );
        canvasSynced += 1;
      } catch (error) {
        canvasFailed += 1;
        await reportFailure(workspaceId, "canvas_sync", error);
      }
    }
    if (connected.has("google")) {
      try {
        await runCalendarReconciliation(env, workspaceId);
      } catch (error) {
        calendarFailed += 1;
        await reportFailure(workspaceId, "calendar_reconciliation", error);
      }
      try {
        const retry = await retryDueDeliveries(env, workspaceId);
        deliveriesRetried += retry.retried;
        deliveriesSent += retry.sent;
      } catch (error) {
        await reportFailure(workspaceId, "delivery_retry_sweep", error);
      }
    }
  }
  return {
    canvasSynced,
    canvasFailed,
    calendarFailed,
    deliveriesRetried,
    deliveriesSent,
    failures,
    workspaces: providers.size,
  };
}

async function runDigestForAllWorkspaces(env: Env, now: Date) {
  const rows = await env.DB.prepare("SELECT id FROM workspace").all<{
    id: string;
  }>();
  const outcomes: Array<{
    workspaceId: string;
    status: string;
    reason: string;
  }> = [];
  for (const row of rows.results) {
    try {
      const outcome = await runDailyDigest(env, row.id, now);
      outcomes.push({ workspaceId: row.id, ...outcome });
      if (outcome.status === "failed") {
        await recordSecurityEvent(
          env.DB,
          "scheduled_job_failed",
          row.id,
          `daily_digest: ${outcome.reason}`.slice(0, 500),
        ).catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ workspaceId: row.id, status: "failed", reason: message });
      console.error(
        JSON.stringify({
          level: "error",
          category: "scheduled_job_failure",
          area: "daily_digest",
          workspaceId: row.id,
          message,
        }),
      );
    }
    // Morning-of exam escalation rides the digest job (no extra cron).
    try {
      const escalation = await sendExamEscalation(env, row.id, now);
      if (escalation.status === "sent") {
        outcomes.push({
          workspaceId: row.id,
          status: "sent",
          reason: "exam_escalation",
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          category: "scheduled_job_failure",
          area: "exam_escalation",
          workspaceId: row.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  await runRetentionCleanup(env, now);
  return { workspaces: rows.results.length, outcomes };
}

async function runEveningForAllWorkspaces(env: Env, now: Date) {
  const rows = await env.DB.prepare("SELECT id FROM workspace").all<{
    id: string;
  }>();
  const outcomes: Array<{
    workspaceId: string;
    status: string;
    reason: string;
  }> = [];
  for (const row of rows.results) {
    try {
      const outcome = await runEveningPreview(env, row.id, now);
      outcomes.push({ workspaceId: row.id, ...outcome });
    } catch (error) {
      outcomes.push({
        workspaceId: row.id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { workspaces: rows.results.length, outcomes };
}

async function runWeeklyForAllWorkspaces(env: Env, now: Date) {
  const rows = await env.DB.prepare("SELECT id FROM workspace").all<{
    id: string;
  }>();
  const outcomes: Array<{
    workspaceId: string;
    status: string;
    reason: string;
  }> = [];
  for (const row of rows.results) {
    try {
      const outcome = await runWeeklyReview(env, row.id, now);
      outcomes.push({ workspaceId: row.id, ...outcome });
    } catch (error) {
      outcomes.push({
        workspaceId: row.id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { workspaces: rows.results.length, outcomes };
}

app.use("*", securityHeaders());

app.get("/health", async (context) => {
  let database: "ok" | "unavailable" = "ok";
  try {
    await context.env.DB.prepare("SELECT 1").first();
  } catch {
    database = "unavailable";
  }
  return context.json(
    {
      ok: database === "ok",
      service: "organato",
      version: "0.1.0",
      emailTemplateVersion: EMAIL_TEMPLATE_VERSION,
      schedulerMode: context.env.SCHEDULER_MODE ?? "local",
      database,
      privateData: false,
    },
    database === "ok" ? 200 : 503,
  );
});

app.route("/api/auth", authRoutes);

// A read-only, user-scoped metadata feed for Studato. It validates Studato's
// signed Supabase session independently and never exposes Organato notes,
// provider identifiers, attachments, history, or credentials.
app.route("/ato/v1", studatoFeedRoutes);

app.get("/api/integrations/google/callback", async (context) =>
  googleIntegrationCallback(context.req.raw, context.env, context.executionCtx),
);

app.post("/api/internal/schedule", async (context) => {
  const authorization = context.req.header("Authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (
    !context.env.SCHEDULER_TOKEN ||
    !supplied ||
    !safeEqual(
      await sha256(supplied),
      await sha256(context.env.SCHEDULER_TOKEN),
    )
  ) {
    return context.json({ error: "Not found." }, 404);
  }
  const job = context.req.query("job");
  if (job === "hourly") {
    return context.json({
      ok: true,
      job,
      ...(await runHourlyForAllWorkspaces(context.env)),
    });
  }
  if (job === "digest") {
    const now = new Date();
    return context.json({
      ok: true,
      job,
      ...(await runDigestForAllWorkspaces(context.env, now)),
    });
  }
  if (job === "evening") {
    const now = new Date();
    return context.json({
      ok: true,
      job,
      ...(await runEveningForAllWorkspaces(context.env, now)),
    });
  }
  if (job === "weekly") {
    const now = new Date();
    return context.json({
      ok: true,
      job,
      ...(await runWeeklyForAllWorkspaces(context.env, now)),
    });
  }
  return context.json({ error: "Unknown job." }, 400);
});

app.route("/api/canvas-device", canvasDeviceRoutes);
app.get("/api/canvas-view", (c) => canvasViewer(c.req.raw, c.env));

app.use("/api/*", requireSession());
app.use("/api/*", async (context, next) => {
  // File uploads are multipart, not JSON — exempt that single route.
  const isAttachmentUpload =
    context.req.method === "POST" &&
    /^\/api\/items\/[^/]+\/attachments\/upload$/.test(context.req.path);
  if (
    !isAttachmentUpload &&
    !["GET", "HEAD", "OPTIONS"].includes(context.req.method) &&
    !context.req
      .header("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return context.json(
      { error: "Expected an application/json request." },
      415,
    );
  }
  await next();
});

app.post("/api/client-diagnostics", async (context) => {
  const user = context.get("user");
  if (
    !(await rateLimit(
      context,
      `client-diagnostics:${user.email.toLowerCase()}`,
      120,
      60,
    ))
  ) {
    return context.json({ ok: true });
  }
  const body = (await context.req.json().catch(() => null)) as {
    kind?: unknown;
    [key: string]: unknown;
  } | null;
  const allowedKinds = new Set([
    "canvas_viewer",
    "interaction",
    "runtime_error",
    "react_error",
    "freeze",
    "crash_recovery",
    "long_task",
  ]);
  if (!body || typeof body.kind !== "string" || !allowedKinds.has(body.kind)) {
    return context.json({ error: "Invalid diagnostic event." }, 400);
  }
  await recordSecurityEvent(
    context.env.DB,
    `client_${body.kind}`,
    user.email,
    JSON.stringify(body),
  );
  return context.json({ ok: true });
});

app.get("/api/client-diagnostics", async (context) => {
  const rows = await context.env.DB.prepare(
    `SELECT category, summary, created_at
     FROM security_event
     WHERE workspace_id = ? AND category LIKE 'client_%'
     ORDER BY created_at DESC
     LIMIT 50`,
  )
    .bind(context.get("user").workspaceId)
    .all<{ category: string; summary: string; created_at: string }>();
  return context.json({ events: rows.results });
});

app.route("/api/integrations/google", googleIntegrationRoutes);
app.route("/api/integrations/canvas/connector", canvasConnectorRoutes);

app.post("/api/integrations/canvas/sync", async (context) => {
  try {
    const workspaceId = context.get("user").workspaceId;
    if (await browserConnectorActive(context.env, workspaceId))
      return connectorStub(context.env, workspaceId).fetch(
        new Request("https://connector/sync", { method: "POST" }),
      );
    const result = await runCanvasSync(context.env, workspaceId, "manual");
    context.executionCtx.waitUntil(
      Promise.all([
        runCalendarReconciliation(context.env, workspaceId),
        sendUrgentImport(
          context.env,
          workspaceId,
          result.runId,
          result.createdIds,
        ),
      ]).then(() => undefined),
    );
    return context.json({ ok: true, runId: result.runId });
  } catch (error) {
    return context.json(
      {
        error: safeCanvasConnectionError(error),
        code: canvasConnectionErrorCode(error),
      },
      502,
    );
  }
});

app.post("/api/integrations/google/reconcile", async (context) => {
  try {
    await runCalendarReconciliation(
      context.env,
      context.get("user").workspaceId,
    );
    return context.json({ ok: true });
  } catch {
    return context.json(
      {
        error:
          "Google Calendar could not be reconciled. The internal Organato calendar is unchanged and pending events will retry.",
      },
      502,
    );
  }
});

app.post("/api/integrations/google/test-email", async (context) => {
  const user = context.get("user");
  if (
    !(await rateLimit(
      context,
      `gmail-test:${user.email.toLowerCase()}`,
      10,
      10,
    ))
  ) {
    return context.json(
      { error: "Test email limit reached. Try again in 10 minutes." },
      429,
    );
  }
  if (isDemoMode(context.env)) {
    return context.json({ ok: true, simulated: true });
  }
  try {
    const sent = await sendTestEmail(context.env, user.workspaceId);
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE integration_connection
       SET status = 'healthy', last_success_at = ?, last_attempt_at = ?,
           last_error_category = NULL, reconnect_needed = 0, updated_at = ?
       WHERE workspace_id = ? AND provider = 'google'`,
    )
      .bind(now, now, now, user.workspaceId)
      .run();
    await recordSecurityEvent(
      context.env.DB,
      "test_email_sent",
      user.email,
      "A production-format reminder preview was accepted by Gmail.",
    );
    return context.json({ ok: true, messageId: sent.messageId });
  } catch (error) {
    if (error instanceof DigestPreviewError) {
      return context.json({ error: error.message }, 409);
    }
    const notConnected =
      error instanceof GoogleConnectionError && error.code === "not_connected";
    const authorizationFailure =
      (error instanceof GoogleConnectionError &&
        error.code === "authorization_failed") ||
      (error instanceof GoogleApiError &&
        (error.status === 401 || error.status === 403));
    const now = new Date().toISOString();
    await context.env.DB.prepare(
      `UPDATE integration_connection
       SET status = ?, last_attempt_at = ?, last_error_category = ?,
           reconnect_needed = ?, updated_at = ?
       WHERE workspace_id = ? AND provider = 'google'`,
    )
      .bind(
        authorizationFailure ? "action_needed" : "delayed",
        now,
        authorizationFailure
          ? "google_authorization_failed"
          : "gmail_temporarily_unavailable",
        authorizationFailure ? 1 : 0,
        now,
        user.workspaceId,
      )
      .run();
    return context.json(
      {
        error: notConnected
          ? "Connect Calendar and Gmail before sending an email preview."
          : authorizationFailure
            ? "Google needs to be reconnected before email can be sent."
            : "Gmail could not accept the reminder preview. Your recipient setting is saved; try again shortly.",
      },
      notConnected ? 409 : 502,
    );
  }
});

app.post("/api/integrations/google/retry-latest", async (context) => {
  if (
    !(await rateLimit(
      context,
      `gmail-retry:${context.get("user").email.toLowerCase()}`,
      5,
      60,
    ))
  ) {
    return context.json(
      { error: "Retry limit reached. Try again in an hour." },
      429,
    );
  }
  try {
    const retried = await retryLatestDelivery(
      context.env,
      context.get("user").workspaceId,
    );
    return retried
      ? context.json({ ok: true })
      : context.json({ error: "No retryable delivery was found." }, 404);
  } catch {
    return context.json(
      { error: "The latest delivery still could not be sent." },
      502,
    );
  }
});

app.post(
  "/api/integrations/google/rebuild",
  requireRecentSession(),
  async (context) => {
    if (
      !(await rateLimit(
        context,
        `calendar-rebuild:${context.get("user").email.toLowerCase()}`,
        3,
        60,
      ))
    ) {
      return context.json(
        { error: "Rebuild limit reached. Try again in an hour." },
        429,
      );
    }
    await context.env.DB.prepare(
      `UPDATE item SET calendar_sync_state = 'pending'
       WHERE workspace_id = ? AND calendar_enabled = 1 AND archived_at IS NULL`,
    )
      .bind(context.get("user").workspaceId)
      .run();
    try {
      await runCalendarReconciliation(
        context.env,
        context.get("user").workspaceId,
      );
      return context.json({ ok: true });
    } catch {
      return context.json(
        {
          error:
            "Calendar rebuild was queued, but reconciliation needs attention. Existing items are unchanged.",
        },
        502,
      );
    }
  },
);

app.post(
  "/api/integrations/google/clear-sync-token",
  requireRecentSession(),
  async (context) => {
    if (
      !(await rateLimit(
        context,
        `calendar-clear-token:${context.get("user").email.toLowerCase()}`,
        3,
        60,
      ))
    ) {
      return context.json(
        { error: "Limit reached. Try again in an hour." },
        429,
      );
    }
    await context.env.DB.prepare(
      `UPDATE integration_connection
       SET metadata_json = json_remove(metadata_json, '$.syncToken'),
           updated_at = ?
       WHERE workspace_id = ? AND provider = 'google'`,
    )
      .bind(new Date().toISOString(), context.get("user").workspaceId)
      .run();
    return context.json({ ok: true });
  },
);

app.post("/api/integrations/google/resolve-conflict", async (context) => {
  const user = context.get("user");
  if (
    !(await rateLimit(
      context,
      `calendar-resolve:${user.email.toLowerCase()}`,
      30,
      60,
    ))
  ) {
    return context.json({ error: "Limit reached. Try again shortly." }, 429);
  }
  const body = (await context.req.json().catch(() => null)) as {
    itemId?: unknown;
    strategy?: unknown;
  } | null;
  if (
    typeof body?.itemId !== "string" ||
    (body.strategy !== "mine" && body.strategy !== "theirs")
  ) {
    return context.json(
      { error: "Provide an itemId and a strategy of mine or theirs." },
      400,
    );
  }
  const { resolved } = await resolveCalendarConflict(
    context.env,
    user.workspaceId,
    body.itemId,
    body.strategy,
  );
  if (!resolved) {
    return context.json(
      { error: "That item is not waiting for conflict resolution." },
      404,
    );
  }
  return context.json({ ok: true });
});

app.route("/api", apiRoutes);

app.all("/api/*", (context) => context.json({ error: "Not found." }, 404));

app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      level: "error",
      category: "unhandled_request",
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      path: context.req.path,
    }),
  );
  return context.json(
    {
      error:
        "Organato could not complete that request. Existing data remains safe; retry or open integration health.",
    },
    500,
  );
});

async function scheduled(
  controller: ScheduledController,
  env: Env,
  executionContext: ExecutionContext,
) {
  if (env.SCHEDULER_MODE !== "cloudflare") return;
  const now = new Date(controller.scheduledTime);
  if (now.getUTCMinutes() === 0) {
    executionContext.waitUntil(runHourlyForAllWorkspaces(env));
  }
  executionContext.waitUntil(drainStorageDeletions(env).catch(() => undefined));
  // Each job self-guards by Sydney hour (digest 6am, evening 8pm, weekly
  // Sun 6pm), so every cron tick can offer all of them without double-send.
  executionContext.waitUntil(runDigestForAllWorkspaces(env, now));
  executionContext.waitUntil(runEveningForAllWorkspaces(env, now));
  executionContext.waitUntil(runWeeklyForAllWorkspaces(env, now));
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

export { app };
