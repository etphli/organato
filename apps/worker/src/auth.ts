import { createRemoteJWKSet, jwtVerify } from "jose";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "./types";
import {
  createSession,
  clearSessionCookies,
  decryptSecret,
  encryptSecret,
  randomToken,
  rateLimit,
  recordSecurityEvent,
  requestMatchesOrigin,
  requireSession,
  sha256,
} from "./security";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function allowList(env: Pick<Env, "ALLOWED_GOOGLE_EMAILS">): Set<string> {
  return new Set(
    env.ALLOWED_GOOGLE_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isConfiguredGoogleEmailAllowed(
  env: Pick<Env, "ALLOWED_GOOGLE_EMAILS">,
  email: string,
): boolean {
  const configured = allowList(env);
  return configured.has("*") || configured.has(email.toLowerCase());
}

function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function isJsonRequest(request: Request) {
  return (
    request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json") ?? false
  );
}

type AuthContext = Context<{ Bindings: Env; Variables: Variables }>;

class GoogleSignInError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403,
    readonly reason = "unknown",
    readonly actorEmail: string | null = null,
  ) {
    super(message);
  }
}

export async function provisionPersonalWorkspace(
  db: D1Database,
  identity: { email: string; displayName: string; googleSubject: string },
  now = new Date().toISOString(),
) {
  await db
    .prepare(
      `INSERT INTO workspace
        (id, name, timezone, settings_json, created_at, updated_at)
       VALUES (?, 'Organato', 'Australia/Sydney', '{}', ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(identity.email, now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO allowed_identity
        (email_normalized, display_name, google_subject, enabled, is_owner,
         last_login_at, created_at, workspace_id)
       VALUES (?, ?, ?, 1, 1, ?, ?, ?)
       ON CONFLICT(email_normalized) DO UPDATE SET
         display_name = excluded.display_name,
         google_subject = COALESCE(allowed_identity.google_subject, excluded.google_subject),
         enabled = 1,
         last_login_at = excluded.last_login_at`,
    )
    .bind(
      identity.email,
      identity.displayName,
      identity.googleSubject,
      now,
      now,
      identity.email,
    )
    .run();
}

async function completeGoogleSignIn(
  context: AuthContext,
  code: string | undefined,
  state: string | undefined,
  redirectUri: string,
): Promise<{ csrfToken: string; returnTo: string }> {
  if (!code || !state) {
    throw new GoogleSignInError(
      "Google sign-in was incomplete.",
      400,
      "missing_callback_parameters",
    );
  }
  const stateHash = await sha256(state);
  const transaction = await context.env.DB.prepare(
    `SELECT nonce_encrypted, code_verifier_encrypted, return_to, expires_at
     FROM oauth_transaction WHERE state_hash = ?`,
  )
    .bind(stateHash)
    .first<{
      nonce_encrypted: string;
      code_verifier_encrypted: string;
      return_to: string;
      expires_at: string;
    }>();
  if (!transaction || new Date(transaction.expires_at) < new Date()) {
    throw new GoogleSignInError(
      "Google sign-in expired. Start again.",
      400,
      "expired_transaction",
    );
  }
  await context.env.DB.prepare(
    "DELETE FROM oauth_transaction WHERE state_hash = ?",
  )
    .bind(stateHash)
    .run();
  const nonce = await decryptSecret(
    transaction.nonce_encrypted,
    context.env.DATA_ENCRYPTION_KEY,
    `oidc:${stateHash}:nonce`,
  );
  const verifier = await decryptSecret(
    transaction.code_verifier_encrypted,
    context.env.DATA_ENCRYPTION_KEY,
    `oidc:${stateHash}:verifier`,
  );
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      code,
      client_id: context.env.GOOGLE_CLIENT_ID,
      client_secret: context.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new GoogleSignInError(
      "Google sign-in could not be verified.",
      401,
      "token_exchange_failed",
    );
  }
  const tokenBody = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenBody.id_token) {
    throw new GoogleSignInError(
      "Google did not return an identity.",
      401,
      "missing_id_token",
    );
  }
  let verified;
  try {
    verified = await jwtVerify(tokenBody.id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: context.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    throw new GoogleSignInError(
      "Google sign-in could not be verified.",
      401,
      "id_token_verification_failed",
    );
  }
  const payload = verified.payload;
  const issuedAt = payload.iat;
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const email =
    typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  const existing = email
    ? await context.env.DB.prepare(
        "SELECT google_subject, enabled FROM allowed_identity WHERE email_normalized = ?",
      )
        .bind(email)
        .first<{ google_subject: string | null; enabled: number }>()
    : null;
  if (!email || typeof payload.sub !== "string" || !payload.sub) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      "missing_identity_claims",
      email || null,
    );
  }
  if (payload.email_verified !== true) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      "email_not_verified",
      email,
    );
  }
  if (payload.nonce !== nonce) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      "nonce_mismatch",
      email,
    );
  }
  if (
    typeof issuedAt !== "number" ||
    issuedAt > nowSeconds + 60 ||
    nowSeconds - issuedAt > 15 * 60
  ) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      "invalid_issued_at",
      email,
    );
  }
  if (
    typeof payload.azp === "string" &&
    payload.azp !== context.env.GOOGLE_CLIENT_ID
  ) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      "authorized_party_mismatch",
      email,
    );
  }
  if (
    !isConfiguredGoogleEmailAllowed(context.env, email) &&
    !existing?.enabled
  ) {
    throw new GoogleSignInError(
      "This Google account has not been approved for Organato.",
      403,
      "email_not_allowed",
      email,
    );
  }
  const subject = payload.sub;
  if (
    existing &&
    (!existing.enabled ||
      (existing.google_subject && existing.google_subject !== subject))
  ) {
    throw new GoogleSignInError(
      "Google sign-in was not accepted.",
      403,
      existing.enabled ? "google_subject_mismatch" : "identity_disabled",
      email,
    );
  }
  const now = new Date().toISOString();
  await provisionPersonalWorkspace(
    context.env.DB,
    {
      email,
      displayName: typeof payload.name === "string" ? payload.name : email,
      googleSubject: subject,
    },
    now,
  );
  const { csrfToken } = await createSession(
    context,
    email,
    context.req.header("User-Agent") ?? "",
  );
  await recordSecurityEvent(
    context.env.DB,
    "sign_in_succeeded",
    email,
    "Google identity verified and a new session was created.",
  );
  return { csrfToken, returnTo: transaction.return_to };
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post("/google/start", async (context) => {
  if (!isJsonRequest(context.req.raw)) {
    return context.json(
      { error: "Expected an application/json request." },
      415,
    );
  }
  if (!requestMatchesOrigin(context.req.raw, context.env.APP_ORIGIN)) {
    return context.json({ error: "Request origin was rejected." }, 403);
  }
  const clientAddress =
    context.req.header("CF-Connecting-IP") ??
    context.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown";
  if (
    !(await rateLimit(
      context,
      `auth-start:${await sha256(clientAddress)}`,
      10,
      60,
    ))
  ) {
    return context.json(
      { error: "Too many sign-in attempts. Try again later." },
      429,
    );
  }
  const body = await context.req
    .json<{ returnTo?: string }>()
    .catch((): { returnTo?: string } => ({}));
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(48);
  const challenge = await sha256(verifier);
  const now = new Date();
  await context.env.DB.prepare(
    `INSERT INTO oauth_transaction
      (state_hash, nonce_hash, nonce_encrypted, code_verifier_encrypted, return_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      await sha256(state),
      await sha256(nonce),
      await encryptSecret(
        nonce,
        context.env.DATA_ENCRYPTION_KEY,
        `oidc:${await sha256(state)}:nonce`,
      ),
      await encryptSecret(
        verifier,
        context.env.DATA_ENCRYPTION_KEY,
        `oidc:${await sha256(state)}:verifier`,
      ),
      body.returnTo && isSafeReturnTo(body.returnTo) ? body.returnTo : "/",
      now.toISOString(),
      new Date(now.getTime() + 10 * 60_000).toISOString(),
    )
    .run();
  const redirectUri = `${context.env.APP_ORIGIN}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: context.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return context.json({
    authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
  });
});

authRoutes.get("/google/callback", async (context) => {
  try {
    const result = await completeGoogleSignIn(
      context,
      context.req.query("code"),
      context.req.query("state"),
      `${context.env.APP_ORIGIN}/api/auth/google/callback`,
    );
    return context.redirect(
      `${context.env.APP_ORIGIN}${result.returnTo}#csrf=${encodeURIComponent(result.csrfToken)}`,
    );
  } catch (error) {
    if (error instanceof GoogleSignInError) {
      await recordSecurityEvent(
        context.env.DB,
        "sign_in_failed",
        error.actorEmail,
        `${error.message} (${error.reason})`,
      );
      return context.text(error.message, error.status);
    }
    throw error;
  }
});

authRoutes.post("/google/exchange", async (context) => {
  if (!isJsonRequest(context.req.raw)) {
    return context.json(
      { error: "Expected an application/json request." },
      415,
    );
  }
  const body = await context.req
    .json<{ code?: string; state?: string }>()
    .catch((): { code?: string; state?: string } => ({}));
  try {
    const result = await completeGoogleSignIn(
      context,
      body.code,
      body.state,
      `${context.env.APP_ORIGIN}/api/auth/google/callback`,
    );
    return context.json({
      authenticated: true,
      csrfToken: result.csrfToken,
      returnTo: result.returnTo,
    });
  } catch (error) {
    if (error instanceof GoogleSignInError) {
      await recordSecurityEvent(
        context.env.DB,
        "sign_in_failed",
        error.actorEmail,
        `${error.message} (${error.reason})`,
      );
      return context.json({ error: error.message }, error.status);
    }
    throw error;
  }
});

authRoutes.post("/logout", requireSession(), async (context) => {
  if (!isJsonRequest(context.req.raw)) {
    return context.json(
      { error: "Expected an application/json request." },
      415,
    );
  }
  const user = context.get("user");
  if (user.sessionIdHash !== "demo") {
    await context.env.DB.prepare(
      "UPDATE session SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL",
    )
      .bind(new Date().toISOString(), user.sessionIdHash)
      .run();
    await recordSecurityEvent(
      context.env.DB,
      "session_revoked",
      user.email,
      "Current session signed out.",
    );
  }
  clearSessionCookies(context);
  return context.json({ ok: true });
});
