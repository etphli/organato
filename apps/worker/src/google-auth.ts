import { GoogleCalendarRestProvider } from "@organato/integrations";
import { Hono } from "hono";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "./security";
import type { Env, Variables } from "./types";

export const googleIntegrationRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

googleIntegrationRoutes.post("/start", async (context) => {
  const user = context.get("user");
  const state = randomToken();
  const verifier = randomToken(48);
  const nonce = randomToken();
  const stateHash = await sha256(state);
  const now = new Date();
  await context.env.DB.prepare(
    `INSERT INTO oauth_transaction
      (state_hash, nonce_hash, nonce_encrypted, code_verifier_encrypted, return_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    )
    .run();
  const params = new URLSearchParams({
    client_id: context.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${context.env.APP_ORIGIN}/api/integrations/google/callback`,
    response_type: "code",
    scope:
      "openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/gmail.send",
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: "S256",
    include_granted_scopes: "true",
  });
  return context.json({
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
});

export async function googleIntegrationCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return new Response("Google connection was incomplete.", { status: 400 });
  const stateHash = await sha256(state);
  const transaction = await env.DB.prepare(
    `SELECT code_verifier_encrypted, return_to, expires_at
     FROM oauth_transaction WHERE state_hash = ?`,
  )
    .bind(stateHash)
    .first<{
      code_verifier_encrypted: string;
      return_to: string;
      expires_at: string;
    }>();
  if (
    !transaction ||
    !transaction.return_to.startsWith("integration:") ||
    new Date(transaction.expires_at) < new Date()
  ) {
    return new Response("Google connection expired.", { status: 400 });
  }
  await env.DB.prepare("DELETE FROM oauth_transaction WHERE state_hash = ?")
    .bind(stateHash)
    .run();
  const email = transaction.return_to.slice("integration:".length);
  const verifier = await decryptSecret(
    transaction.code_verifier_encrypted,
    env.DATA_ENCRYPTION_KEY,
    `oidc:${stateHash}:verifier`,
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  if (!tokens.refresh_token) {
    return new Response(
      "Google did not provide background authorization. Reconnect with consent.",
      { status: 400 },
    );
  }
  const granted = new Set(tokens.scope.split(" "));
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
      return tokens.access_token;
    },
  };
  const calendar = new GoogleCalendarRestProvider(tokenSource);
  const calendarId = await calendar.ensureOrganatoCalendar();
  const encrypted = await encryptSecret(
    tokens.refresh_token,
    env.DATA_ENCRYPTION_KEY,
    `integration:google:${email}`,
  );
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO integration_connection
      (provider, account_label, status, scopes_json, encrypted_credential,
       credential_key_version, last_success_at, last_attempt_at, reconnect_needed,
       metadata_json, updated_at)
     VALUES ('google', ?, 'healthy', ?, ?, 1, ?, ?, 0, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
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
      email,
      JSON.stringify(required),
      encrypted,
      now,
      now,
      JSON.stringify({ email, calendarId, recipients: [email] }),
      now,
    )
    .run();
  await env.DB.prepare(
    "UPDATE workspace SET integration_owner_email = ?, updated_at = ? WHERE id = 'workspace'",
  )
    .bind(email, now)
    .run();
  return Response.redirect(
    `${env.APP_ORIGIN}/settings/calendar?connected=1`,
    302,
  );
}
