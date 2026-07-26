import { Hono } from "hono";
import { apiRoutes } from "./api";
import { authRoutes } from "./auth";
import {
  googleIntegrationCallback,
  googleIntegrationRoutes,
} from "./google-auth";
import { rateLimit, requireSession, securityHeaders } from "./security";
import {
  runCalendarReconciliation,
  runCanvasSync,
  runDailyDigest,
  sendTestEmail,
  sendUrgentImport,
} from "./sync";
import { sha256 } from "./security";
import type { Env, Variables } from "./types";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

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

app.get("/api/integrations/google/callback", async (context) =>
  googleIntegrationCallback(context.req.raw, context.env),
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
    const canvasConnection = await context.env.DB.prepare(
      `SELECT 1 AS connected FROM integration_connection
       WHERE provider = 'canvas' AND status <> 'disconnected'`,
    ).first<{ connected: number }>();
    if (!canvasConnection) {
      return context.json({
        ok: true,
        job,
        skipped: "canvas_not_connected",
      });
    }
    const result = await runCanvasSync(context.env, "scheduled");
    await runCalendarReconciliation(context.env);
    await sendUrgentImport(context.env, result.runId, result.createdIds);
    return context.json({ ok: true, job });
  }
  if (job === "digest") {
    await runDailyDigest(context.env, new Date());
    return context.json({ ok: true, job });
  }
  return context.json({ error: "Unknown job." }, 400);
});

app.use("/api/*", requireSession());

app.route("/api/integrations/google", googleIntegrationRoutes);

app.post("/api/integrations/canvas/sync", async (context) => {
  try {
    const result = await runCanvasSync(context.env, "manual");
    context.executionCtx.waitUntil(
      Promise.all([
        runCalendarReconciliation(context.env),
        sendUrgentImport(context.env, result.runId, result.createdIds),
      ]).then(() => undefined),
    );
    return context.json({ ok: true, runId: result.runId });
  } catch {
    return context.json(
      {
        error:
          "Canvas could not be checked. Existing Organato items are unchanged; review integration health and retry.",
      },
      502,
    );
  }
});

app.post("/api/integrations/google/reconcile", async (context) => {
  try {
    await runCalendarReconciliation(context.env);
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
    const sent = await sendTestEmail(context.env);
    return context.json({ ok: true, messageId: sent.messageId });
  } catch {
    return context.json(
      {
        error:
          "The test email could not be sent. Existing reminder settings are unchanged; reconnect Google and retry.",
      },
      502,
    );
  }
});

app.post("/api/integrations/google/rebuild", async (context) => {
  await context.env.DB.prepare(
    `UPDATE item SET calendar_sync_state = 'pending'
     WHERE calendar_enabled = 1 AND archived_at IS NULL`,
  ).run();
  try {
    await runCalendarReconciliation(context.env);
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
     WHERE provider = 'google'`,
  )
    .bind(new Date().toISOString())
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
    executionContext.waitUntil(
      runCanvasSync(env, "scheduled")
        .then(async (result) => {
          await runCalendarReconciliation(env);
          await sendUrgentImport(env, result.runId, result.createdIds);
        })
        .catch(async () => {
          await env.DB.prepare(
            `UPDATE integration_connection SET status = 'action_needed',
             last_attempt_at = ?, last_error_category = 'scheduled_sync_failed',
             updated_at = ? WHERE provider = 'canvas'`,
          )
            .bind(new Date().toISOString(), new Date().toISOString())
            .run();
        }),
    );
  }
  executionContext.waitUntil(runDailyDigest(env, now));
}

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

export { app };
