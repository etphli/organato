import { createRemoteJWKSet, jwtVerify } from "jose";
import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env, Variables } from "./types";
import {
  createSession,
  decryptSecret,
  encryptSecret,
  randomToken,
  sha256,
} from "./security";

const googleJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

function allowList(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_GOOGLE_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

type AuthContext = Context<{ Bindings: Env; Variables: Variables }>;

class GoogleSignInError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403,
  ) {
    super(message);
  }
}

async function completeGoogleSignIn(
  context: AuthContext,
  code: string | undefined,
  state: string | undefined,
  redirectUri: string,
): Promise<{ csrfToken: string; returnTo: string }> {
  if (!code || !state) {
    throw new GoogleSignInError("Google sign-in was incomplete.", 400);
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
    throw new GoogleSignInError("Google sign-in expired. Start again.", 400);
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
    throw new GoogleSignInError("Google sign-in could not be verified.", 401);
  }
  const tokenBody = (await tokenResponse.json()) as { id_token?: string };
  if (!tokenBody.id_token) {
    throw new GoogleSignInError("Google did not return an identity.", 401);
  }
  let verified;
  try {
    verified = await jwtVerify(tokenBody.id_token, googleJwks, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: context.env.GOOGLE_CLIENT_ID,
    });
  } catch {
    throw new GoogleSignInError("Google sign-in could not be verified.", 401);
  }
  const payload = verified.payload;
  const email =
    typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (
    !email ||
    payload.email_verified !== true ||
    payload.nonce !== nonce ||
    !allowList(context.env).has(email)
  ) {
    throw new GoogleSignInError("Google sign-in was not accepted.", 403);
  }
  const subject = payload.sub;
  const existing = await context.env.DB.prepare(
    "SELECT google_subject, enabled FROM allowed_identity WHERE email_normalized = ?",
  )
    .bind(email)
    .first<{ google_subject: string | null; enabled: number }>();
  if (
    existing &&
    (!existing.enabled ||
      (existing.google_subject && existing.google_subject !== subject))
  ) {
    throw new GoogleSignInError("Google sign-in was not accepted.", 403);
  }
  const now = new Date().toISOString();
  await context.env.DB.prepare(
    `INSERT INTO allowed_identity
      (email_normalized, display_name, google_subject, enabled, is_owner, last_login_at, created_at)
     VALUES (?, ?, ?, 1, 1, ?, ?)
     ON CONFLICT(email_normalized) DO UPDATE SET
       display_name = excluded.display_name,
       google_subject = COALESCE(allowed_identity.google_subject, excluded.google_subject),
       last_login_at = excluded.last_login_at`,
  )
    .bind(
      email,
      typeof payload.name === "string" ? payload.name : email,
      subject,
      now,
      now,
    )
    .run();
  const { csrfToken } = await createSession(
    context,
    email,
    context.req.header("User-Agent") ?? "",
  );
  return { csrfToken, returnTo: transaction.return_to };
}

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post("/google/start", async (context) => {
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
      return context.text(error.message, error.status);
    }
    throw error;
  }
});

authRoutes.post("/google/exchange", async (context) => {
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
      return context.json({ error: error.message }, error.status);
    }
    throw error;
  }
});

authRoutes.post("/logout", async (context) => {
  deleteCookie(context, "organato_session", { path: "/" });
  return context.json({ ok: true });
});
