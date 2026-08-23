import { GoogleCalendarRestProvider } from "@organato/integrations";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { z } from "zod";
import {
  decryptSecret,
  encryptSecret,
  randomToken,
  recordSecurityEvent,
  requireRecentSession,
  sha256,
} from "./security";
import { runCalendarReconciliation } from "./sync";
import {
  getGoogleDeliverySettings,
  updateGoogleRecipients,
} from "./google-connection";
import type { Env, Variables } from "./types";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

interface GoogleIntegrationIdentity {
  email: string;
  subject: string;
}

export function validateGoogleIntegrationClaims(
  payload: JWTPayload,
  expected: {
    clientId: string;
    email: string;
    subject: string;
    nonce: string;
    now?: Date;
  },
): GoogleIntegrationIdentity {
  const nowSeconds = Math.floor((expected.now ?? new Date()).getTime() / 1_000);
  const email =
    typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (
    !email ||
    email !== expected.email.toLowerCase() ||
    payload.email_verified !== true ||
    payload.sub !== expected.subject ||
    payload.nonce !== expected.nonce ||
    (typeof payload.azp === "string" && payload.azp !== expected.clientId) ||
    typeof payload.iat !== "number" ||
    payload.iat > nowSeconds + 60 ||
    nowSeconds - payload.iat > 15 * 60
  ) {
    throw new Error("google_integration_identity_mismatch");
  }
  return { email, subject: payload.sub };
}

export const googleIntegrationRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

const recipientSchema = z
  .object({
    recipients: z
      .array(
        z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((email) => email.toLowerCase()),
      )
      .min(1)
      .max(5),
  })
  .strict();

const integrationCallbackSchema = z
  .object({
    code: z.string().min(1).max(4_096),
    state: z.string().min(16).max(512),
  })
  .strict();

googleIntegrationRoutes.get("/settings", async (context) =>
  context.json(
    await getGoogleDeliverySettings(
      context.env,
      context.get("user").workspaceId,
    ),
  ),
);

googleIntegrationRoutes.post(
  "/exchange",
  zValidator("json", integrationCallbackSchema),
  async (context) => {
    const callback = new URL(
      "/api/integrations/google/callback",
      context.env.APP_ORIGIN,
    );
    const input = context.req.valid("json");
    callback.searchParams.set("code", input.code);
    callback.searchParams.set("state", input.state);
    try {
      const response = await googleIntegrationCallback(
        new Request(callback.toString()),
        context.env,
        context.executionCtx,
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("Location");
        const returnTo = location
          ? `${new URL(location).pathname}${new URL(location).search}`
          : "/settings/calendar?connected=1";
        return context.json({ connected: true, returnTo });
      }
      return context.json(
        {
          error:
            (await response.text()) ||
            "Google connection could not be completed.",
        },
        response.status === 403 ? 403 : 400,
      );
    } catch {
      return context.json(
        {
          error:
            "Google connection could not finish safely. Start the connection again.",
        },
        502,
      );
    }
  },
);

googleIntegrationRoutes.put(
  "/recipients",
  requireRecentSession(7 * 24 * 60),
  zValidator("json", recipientSchema),
  async (context) => {
    const recipients = [...new Set(context.req.valid("json").recipients)];
    try {
      const settings = await updateGoogleRecipients(
        context.env,
        context.get("user").workspaceId,
        recipients,
      );
      await recordSecurityEvent(
        context.env.DB,
        "email_recipients_changed",
        context.get("user").email,
        `Reminder delivery now has ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}.`,
      );
      return context.json(settings);
    } catch {
      return context.json(
        { error: "Connect Calendar and Gmail before choosing recipients." },
        409,
      );
    }
  },
);

googleIntegrationRoutes.post(
  "/start",
  requireRecentSession(),
  async (context) => {
    const user = context.get("user");
    const state = randomToken();
    const verifier = randomToken(48);
    const nonce = randomToken();
    const stateHash = await sha256(state);
    const now = new Date();
    await context.env.DB.prepare(
      `INSERT INTO oauth_transaction
        (state_hash, nonce_hash, nonce_encrypted, code_verifier_encrypted,
         return_to, created_at, expires_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        stateHash,
        await sha256(nonce),
        await encryptSecret(
          nonce,
          context.env.DATA_ENCRYPTION_KEY,
          `oidc:${stateHash}:nonce`,
        ),
        await encryptSecret(
          verifier,
          context.env.DATA_ENCRYPTION_KEY,
          `oidc:${stateHash}:verifier`,
        ),
        `integration:${user.email}`,
        now.toISOString(),
        new Date(now.getTime() + 10 * 60_000).toISOString(),
        user.workspaceId,
      )
      .run();
    const params = new URLSearchParams({
      client_id: context.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${context.env.APP_ORIGIN}/api/integrations/google/callback`,
      response_type: "code",
      scope:
        "openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/gmail.send",
      access_type: "offline",
      prompt: "consent select_account",
      state,
      nonce,
      code_challenge: await sha256(verifier),
      code_challenge_method: "S256",
      include_granted_scopes: "true",
    });
    return context.json({
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    });
  },
);

googleIntegrationRoutes.post(
  "/disconnect",
  requireRecentSession(),
  async (context) => {
    const row = await context.env.DB.prepare(
      `SELECT encrypted_credential, metadata_json
       FROM integration_connection WHERE workspace_id = ? AND provider = 'google'`,
    )
      .bind(context.get("user").workspaceId)
      .first<{
        encrypted_credential: string | null;
        metadata_json: string;
      }>();
    let providerRevoked = false;
    if (row?.encrypted_credential) {
      try {
        const metadata = JSON.parse(row.metadata_json) as { email?: string };
        if (metadata.email) {
          const refreshToken = await decryptSecret(
            row.encrypted_credential,
            context.env.DATA_ENCRYPTION_KEY,
            `integration:google:${metadata.email}`,
          );
          const response = await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: refreshToken }),
            signal: AbortSignal.timeout(10_000),
          });
          providerRevoked = response.ok;
        }
      } catch {
        providerRevoked = false;
      }
    }
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE integration_connection
           SET status = 'disconnected', encrypted_credential = NULL,
               reconnect_needed = 0, last_attempt_at = ?,
               last_error_category = ?, updated_at = ?
           WHERE workspace_id = ? AND provider = 'google'`,
      ).bind(
        now,
        providerRevoked ? null : "provider_revocation_unconfirmed",
        now,
        context.get("user").workspaceId,
      ),
      context.env.DB.prepare(
        `UPDATE workspace SET integration_owner_email = NULL, updated_at = ?
           WHERE id = ?`,
      ).bind(now, context.get("user").workspaceId),
    ]);
    await recordSecurityEvent(
      context.env.DB,
      "google_disconnected",
      context.get("user").email,
      providerRevoked
        ? "Google authorization was revoked and disconnected."
        : "Google credentials were removed locally; provider revocation could not be confirmed.",
    );
    return context.json({ ok: true, providerRevoked });
  },
);

export async function googleIntegrationCallback(
  request: Request,
  env: Env,
  executionContext?: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return new Response("Google connection was incomplete.", { status: 400 });
  const stateHash = await sha256(state);
  const transaction = await env.DB.prepare(
    `SELECT nonce_encrypted, code_verifier_encrypted, return_to, expires_at,
            workspace_id
     FROM oauth_transaction WHERE state_hash = ?`,
  )
    .bind(stateHash)
    .first<{
      nonce_encrypted: string;
      code_verifier_encrypted: string;
      return_to: string;
      expires_at: string;
      workspace_id: string | null;
    }>();
  if (
    !transaction ||
    !transaction.workspace_id ||
    !transaction.return_to.startsWith("integration:") ||
    new Date(transaction.expires_at) < new Date()
  ) {
    return new Response("Google connection expired.", { status: 400 });
  }
  await env.DB.prepare("DELETE FROM oauth_transaction WHERE state_hash = ?")
    .bind(stateHash)
    .run();
  const email = transaction.return_to.slice("integration:".length);
  const workspaceId = transaction.workspace_id;
  const nonce = await decryptSecret(
    transaction.nonce_encrypted,
    env.DATA_ENCRYPTION_KEY,
    `oidc:${stateHash}:nonce`,
  );
  const verifier = await decryptSecret(
    transaction.code_verifier_encrypted,
    env.DATA_ENCRYPTION_KEY,
    `oidc:${stateHash}:verifier`,
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.APP_ORIGIN}/api/integrations/google/callback`,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok)
    return new Response("Google connection failed safely.", { status: 400 });
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token || !tokens.id_token) {
    return new Response(
      "Google did not provide complete background authorization. Reconnect with consent.",
      { status: 400 },
    );
  }
  const ownerIdentity = await env.DB.prepare(
    `SELECT google_subject, enabled
     FROM allowed_identity
     WHERE email_normalized = ? AND workspace_id = ? AND is_owner = 1`,
  )
    .bind(email.toLowerCase(), workspaceId)
    .first<{ google_subject: string | null; enabled: number }>();
  if (!ownerIdentity?.enabled || !ownerIdentity.google_subject) {
    return new Response("The Organato owner identity is not eligible.", {
      status: 403,
    });
  }
  try {
    const verified = await jwtVerify(tokens.id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: env.GOOGLE_CLIENT_ID,
    });
    validateGoogleIntegrationClaims(verified.payload, {
      clientId: env.GOOGLE_CLIENT_ID,
      email,
      subject: ownerIdentity.google_subject,
      nonce,
    });
  } catch {
    await recordSecurityEvent(
      env.DB,
      "google_connect_rejected",
      email,
      "Google integration identity did not match the verified Organato owner.",
    );
    return new Response(
      "Connect Calendar and Gmail with the same Google account used for Organato.",
      { status: 403 },
    );
  }
  const granted = new Set((tokens.scope ?? "").split(" ").filter(Boolean));
  const required = [
    "https://www.googleapis.com/auth/calendar.app.created",
    "https://www.googleapis.com/auth/gmail.send",
  ];
  if (!required.every((scope) => granted.has(scope))) {
    return new Response("The required narrow Google scopes were not granted.", {
      status: 400,
    });
  }
  const tokenSource = {
    async accessToken() {
      return tokens.access_token!;
    },
  };
  const calendar = new GoogleCalendarRestProvider(tokenSource);
  const previous = await env.DB.prepare(
    `SELECT metadata_json FROM integration_connection
     WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(workspaceId)
    .first<{ metadata_json: string }>();
  let previousCalendarId: string | undefined;
  let previousRecipients: string[] = [];
  try {
    const metadata = JSON.parse(previous?.metadata_json ?? "{}") as {
      calendarId?: string;
      recipients?: string[];
    };
    previousCalendarId = metadata.calendarId;
    previousRecipients = Array.isArray(metadata.recipients)
      ? metadata.recipients
      : [];
  } catch {
    previousCalendarId = undefined;
    previousRecipients = [];
  }
  const calendarId = await calendar.ensureOrganatoCalendar(previousCalendarId);
  const encrypted = await encryptSecret(
    tokens.refresh_token,
    env.DATA_ENCRYPTION_KEY,
    `integration:google:${email}`,
  );
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO integration_connection
      (workspace_id, provider, account_label, status, scopes_json, encrypted_credential,
       credential_key_version, last_success_at, last_attempt_at, reconnect_needed,
       metadata_json, updated_at)
     VALUES (?, 'google', ?, 'healthy', ?, ?, 1, ?, ?, 0, ?, ?)
     ON CONFLICT(workspace_id, provider) DO UPDATE SET
       account_label = excluded.account_label,
       status = 'healthy',
       scopes_json = excluded.scopes_json,
       encrypted_credential = excluded.encrypted_credential,
       last_success_at = excluded.last_success_at,
       last_attempt_at = excluded.last_attempt_at,
       reconnect_needed = 0,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      workspaceId,
      email,
      JSON.stringify(required),
      encrypted,
      now,
      now,
      JSON.stringify({
        email,
        calendarId,
        recipients: previousRecipients.length ? previousRecipients : [email],
      }),
      now,
    )
    .run();
  await env.DB.prepare(
    "UPDATE workspace SET integration_owner_email = ?, updated_at = ? WHERE id = ?",
  )
    .bind(email, now, workspaceId)
    .run();
  await env.DB.prepare(
    `UPDATE item SET calendar_sync_state = 'pending'
     WHERE workspace_id = ? AND calendar_enabled = 1 AND archived_at IS NULL`,
  )
    .bind(workspaceId)
    .run();
  await recordSecurityEvent(
    env.DB,
    "google_connected",
    email,
    "Verified Google Calendar and Gmail authorization was connected.",
  );
  const reconciliation = runCalendarReconciliation(env, workspaceId).catch(
    async () =>
      env.DB.prepare(
        `UPDATE integration_connection
           SET status = 'delayed', last_error_category = 'initial_reconcile_failed',
               updated_at = ? WHERE workspace_id = ? AND provider = 'google'`,
      )
        .bind(new Date().toISOString(), workspaceId)
        .run(),
  );
  if (executionContext) executionContext.waitUntil(reconciliation);
  else await reconciliation;
  return Response.redirect(
    `${env.APP_ORIGIN}/settings/calendar?connected=1`,
    302,
  );
}
