import { GoogleApiError } from "@organato/integrations";
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
  rateLimit,
  recordSecurityEvent,
  requireSession,
  securityHeaders,
} from "./security";
import {
  runCalendarReconciliation,
  runCanvasSync,
  runDailyDigest,
  runRetentionCleanup,
  retryLatestDelivery,
  sendTestEmail,
  sendUrgentImport,
} from "./sync";
import { sha256 } from "./security";
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
  for (const [workspaceId, connected] of providers) {
    if (connected.has("canvas")) {
      try {
        const result = await runCanvasSync(env, workspaceId, "scheduled");
        await sendUrgentImport(
          env,
          workspaceId,
          result.runId,
          result.createdIds,
        );
        canvasSynced += 1;
      } catch {
        canvasFailed += 1;
      }
    }
    if (connected.has("google")) {
      await runCalendarReconciliation(env, workspaceId).catch(() => undefined);
    }
  }
  return { canvasSynced, canvasFailed, workspaces: providers.size };
}

async function runDigestForAllWorkspaces(env: Env, now: Date) {
  const rows = await env.DB.prepare("SELECT id FROM workspace").all<{
    id: string;
  }>();
  for (const row of rows.results) {
    await runDailyDigest(env, row.id, now).catch(() => undefined);
  }
  await runRetentionCleanup(env, now);
  return { workspaces: rows.results.length };
}

app.use("*", securityHeaders());

app.get("/health", (context) =>
  context.json({
    ok: true,
    service: "organato",
    version: "0.1.0",
    privateData: false,
  }),
);

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
    (await sha256(supplied)) !== (await sha256(context.env.SCHEDULER_TOKEN))
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
  return context.json({ error: "Unknown job." }, 400);
});

app.use("/api/*", requireSession());
app.use("/api/*", async (context, next) => {
  if (
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

app.route("/api/integrations/google", googleIntegrationRoutes);

app.post("/api/integrations/canvas/sync", async (context) => {
  try {
    const workspaceId = context.get("user").workspaceId;
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
    !(await rateLimit(context, `gmail-test:${user.email.toLowerCase()}`, 3, 60))
  ) {
    return context.json(
      { error: "Test email limit reached. Try again in an hour." },
      429,
    );
  }
  if (context.env.DEMO_MODE === "true") {
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
      "A private Organato test email was accepted by Gmail.",
    );
    return context.json({ ok: true, messageId: sent.messageId });
  } catch (error) {
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
          ? "Connect Calendar and Gmail before sending a test email."
          : authorizationFailure
            ? "Google needs to be reconnected before email can be sent."
            : "Gmail could not accept the test message. Your recipient setting is saved; try again shortly.",
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

app.post("/api/integrations/google/rebuild", async (context) => {
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
});

app.post("/api/integrations/google/clear-sync-token", async (context) => {
  await context.env.DB.prepare(
    `UPDATE integration_connection
     SET metadata_json = json_remove(metadata_json, '$.syncToken'),
         updated_at = ?
     WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(new Date().toISOString(), context.get("user").workspaceId)
    .run();
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
      message: error instanceof Error ? error.name : "unknown",
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
  executionContext.waitUntil(runDigestForAllWorkspaces(env, now));
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

export { app };
