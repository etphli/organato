import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, SessionUser, Variables } from "./types";

const encoder = new TextEncoder();
const sessionCookie = "organato_session";
const csrfCookie = "organato_csrf";
const sessionIdleDays = 30;
const sessionAbsoluteDays = 180;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(
    normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="),
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function randomToken(length = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

export async function sha256(value: string): Promise<string> {
  return bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}

export async function encryptSecret(
  plaintext: string,
  keyBase64Url: string,
  aad: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64UrlToBytes(keyBase64Url)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: encoder.encode(aad),
    },
    key,
    encoder.encode(plaintext),
  );
  return JSON.stringify({
    version: 1,
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  });
}

export async function decryptSecret(
  envelopeJson: string,
  keyBase64Url: string,
  aad: string,
): Promise<string> {
  const envelope = JSON.parse(envelopeJson) as {
    version: number;
    iv: string;
    ciphertext: string;
  };
  if (envelope.version !== 1)
    throw new Error("Unsupported credential key version.");
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(base64UrlToBytes(keyBase64Url)),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(envelope.iv)),
      additionalData: encoder.encode(aad),
    },
    key,
    toArrayBuffer(base64UrlToBytes(envelope.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (context, next) => {
    await next();
    const pathname = new URL(context.req.url).pathname;
    if (pathname.startsWith("/api/")) {
      context.header(
        "Cache-Control",
        "private, no-store, no-cache, max-age=0, must-revalidate",
      );
      context.header("CDN-Cache-Control", "no-store");
      context.header("Vercel-CDN-Cache-Control", "no-store");
      context.header("Pragma", "no-cache");
      context.header("Vary", "Cookie, Authorization");
    }
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://lh3.googleusercontent.com; connect-src 'self' wss://organato.etphli.workers.dev https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://gmail.googleapis.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://accounts.google.com",
    );
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "strict-origin-when-cross-origin");
    context.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    context.header("X-Frame-Options", "DENY");
    if (context.req.url.startsWith("https:")) {
      context.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  };
}

export function requestMatchesOrigin(request: Request, appOrigin: string) {
  const expected = new URL(appOrigin).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === expected;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

export function hasRecentAuthentication(
  authenticatedAt: string,
  now = new Date(),
  maximumAgeMinutes = 10,
) {
  const timestamp = new Date(authenticatedAt).getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp <= now.getTime() &&
    now.getTime() - timestamp <= maximumAgeMinutes * 60_000
  );
}

export async function recordSecurityEvent(
  db: D1Database,
  category: string,
  actorEmail: string | null,
  summary: string,
) {
  await db
    .prepare(
      `INSERT INTO security_event
        (id, workspace_id, category, actor_email, summary, created_at)
       VALUES (?,
         CASE WHEN EXISTS (SELECT 1 FROM workspace WHERE id = ?) THEN ? ELSE NULL END,
         ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      actorEmail?.toLowerCase() ?? null,
      actorEmail?.toLowerCase() ?? null,
      category.slice(0, 100),
      actorEmail?.toLowerCase() ?? null,
      summary.slice(0, 500),
      new Date().toISOString(),
    )
    .run();
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export async function createSession(
  context: Context<{ Bindings: Env; Variables: Variables }>,
  email: string,
  userAgent: string,
): Promise<{ csrfToken: string }> {
  const sessionId = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const idle = new Date(now.getTime() + sessionIdleDays * 86_400_000);
  const absolute = new Date(now.getTime() + sessionAbsoluteDays * 86_400_000);
  // Tolerate databases that have not applied migration 0005 yet: fall back
  // to a legacy insert without the column so deploys never break sign-in.
  try {
    await context.env.DB.prepare(
      `INSERT INTO session
        (id_hash, email_normalized, csrf_hash, user_agent, created_at, last_activity_at, idle_expires_at, absolute_expires_at, authenticated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        await sha256(sessionId),
        email.toLowerCase(),
        await sha256(csrfToken),
        userAgent.slice(0, 255),
        now.toISOString(),
        now.toISOString(),
        idle.toISOString(),
        absolute.toISOString(),
        now.toISOString(),
      )
      .run();
  } catch {
    await context.env.DB.prepare(
      `INSERT INTO session
        (id_hash, email_normalized, csrf_hash, user_agent, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        await sha256(sessionId),
        email.toLowerCase(),
        await sha256(csrfToken),
        userAgent.slice(0, 255),
        now.toISOString(),
        now.toISOString(),
        idle.toISOString(),
        absolute.toISOString(),
      )
      .run();
  }
  setCookie(context, sessionCookie, sessionId, {
    secure: new URL(context.env.APP_ORIGIN).protocol === "https:",
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: sessionAbsoluteDays * 86_400,
  });
  // Keep the proxied sign-in response to one Set-Cookie header. The first
  // authenticated /api/session request issues the browser-readable CSRF cookie.
  return { csrfToken };
}

export function clearSessionCookies(
  context: Context<{ Bindings: Env; Variables: Variables }>,
) {
  deleteCookie(context, sessionCookie, { path: "/" });
  deleteCookie(context, csrfCookie, { path: "/" });
}

export async function getOrCreateCsrfToken(
  context: Context<{ Bindings: Env; Variables: Variables }>,
) {
  const user = context.get("user");
  if (user.sessionIdHash === "demo") return "demo-csrf";
  const existing = getCookie(context, csrfCookie);
  if (existing) {
    const row = await context.env.DB.prepare(
      "SELECT csrf_hash FROM session WHERE id_hash = ? AND revoked_at IS NULL",
    )
      .bind(user.sessionIdHash)
      .first<{ csrf_hash: string }>();
    if (row && safeEqual(await sha256(existing), row.csrf_hash)) {
      return existing;
    }
  }
  const csrfToken = randomToken();
  await context.env.DB.prepare(
    "UPDATE session SET csrf_hash = ? WHERE id_hash = ? AND revoked_at IS NULL",
  )
    .bind(await sha256(csrfToken), user.sessionIdHash)
    .run();
  setCookie(context, csrfCookie, csrfToken, {
    secure: new URL(context.env.APP_ORIGIN).protocol === "https:",
    httpOnly: false,
    sameSite: "Strict",
    path: "/",
    maxAge: sessionAbsoluteDays * 86_400,
  });
  return csrfToken;
}

export function isDemoMode(env: Pick<Env, "DEMO_MODE">): boolean {
  return env.DEMO_MODE === "true";
}

export function requireSession(): MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> {
  return async (context, next) => {
    if (isDemoMode(context.env)) {
      context.set("user", {
        email: "owner@example.com",
        workspaceId: "owner@example.com",
        displayName: "Alex Smith",
        csrfToken: "demo-csrf",
        sessionIdHash: "demo",
        authenticatedAt: new Date().toISOString(),
      });
      await next();
      return;
    }
    const sessionId = getCookie(context, sessionCookie);
    if (!sessionId)
      return context.json({ error: "Authentication required." }, 401);
    const sessionHash = await sha256(sessionId);
    const columns = `s.id_hash, s.csrf_hash,
            COALESCE(s.authenticated_at, s.created_at) AS authenticated_at,
            s.idle_expires_at, s.absolute_expires_at`;
    let row: {
      id_hash: string;
      csrf_hash: string;
      authenticated_at: string;
      idle_expires_at: string;
      absolute_expires_at: string;
      email_normalized: string;
      workspace_id: string;
      display_name: string;
      enabled: number;
    } | null;
    try {
      row = await context.env.DB.prepare(
        `SELECT ${columns},
                i.email_normalized, i.workspace_id, i.display_name, i.enabled
         FROM session s
         JOIN allowed_identity i ON i.email_normalized = s.email_normalized
         WHERE s.id_hash = ? AND s.revoked_at IS NULL`,
      )
        .bind(sessionHash)
        .first<NonNullable<typeof row>>();
    } catch {
      // Pre-migration-0005 database: fall back to creation time as the
      // authentication stamp.
      row = await context.env.DB.prepare(
        `SELECT s.id_hash, s.csrf_hash, s.created_at AS authenticated_at,
                s.idle_expires_at, s.absolute_expires_at,
                i.email_normalized, i.workspace_id, i.display_name, i.enabled
         FROM session s
         JOIN allowed_identity i ON i.email_normalized = s.email_normalized
         WHERE s.id_hash = ? AND s.revoked_at IS NULL`,
      )
        .bind(sessionHash)
        .first<NonNullable<typeof row>>();
    }
    if (
      !row ||
      !row.enabled ||
      new Date(row.idle_expires_at) < new Date() ||
      new Date(row.absolute_expires_at) < new Date()
    ) {
      return context.json({ error: "Session expired." }, 401);
    }
    const csrfToken = context.req.header("X-CSRF-Token") ?? "";
    const user: SessionUser = {
      email: row.email_normalized,
      workspaceId: row.workspace_id,
      displayName: row.display_name,
      csrfToken,
      sessionIdHash: row.id_hash,
      authenticatedAt: row.authenticated_at,
    };
    context.set("user", user);
    if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
      if (!requestMatchesOrigin(context.req.raw, context.env.APP_ORIGIN)) {
        return context.json({ error: "Request origin was rejected." }, 403);
      }
      const csrfCookieToken = getCookie(context, csrfCookie) ?? "";
      const headerMatches =
        csrfToken && safeEqual(await sha256(csrfToken), row.csrf_hash);
      const cookieMatches =
        csrfCookieToken &&
        safeEqual(await sha256(csrfCookieToken), row.csrf_hash);
      if (!headerMatches && !cookieMatches) {
        return context.json({ error: "CSRF validation failed." }, 403);
      }
    }
    const nextIdleExpiry = new Date(
      Math.min(
        Date.now() + sessionIdleDays * 86_400_000,
        new Date(row.absolute_expires_at).getTime(),
      ),
    ).toISOString();
    context.executionCtx.waitUntil(
      context.env.DB.prepare(
        "UPDATE session SET last_activity_at = ?, idle_expires_at = ? WHERE id_hash = ?",
      )
        .bind(new Date().toISOString(), nextIdleExpiry, row.id_hash)
        .run(),
    );
    await next();
  };
}

export function requireRecentSession(
  maximumAgeMinutes = 10,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (context, next) => {
    if (
      !isDemoMode(context.env) &&
      !hasRecentAuthentication(
        context.get("user").authenticatedAt,
        new Date(),
        maximumAgeMinutes,
      )
    ) {
      return context.json(
        {
          error: "Confirm your Google sign-in before continuing.",
          code: "reauthentication_required",
        },
        403,
      );
    }
    await next();
  };
}

export async function rateLimit(
  context: { env: Env },
  key: string,
  limit: number,
  windowMinutes = 60,
): Promise<boolean> {
  // Epoch-based bucketing so windows longer than an hour (e.g. the 24-hour
  // delete-all limit) actually span wall-clock time instead of resetting
  // whenever the clock minute wraps.
  const windowMs = windowMinutes * 60_000;
  const windowStart = new Date(
    Math.floor(Date.now() / windowMs) * windowMs,
  ).toISOString();
  // Single-statement increment-and-read so concurrent requests cannot
  // undercount and over-allow.
  const row = await context.env.DB.prepare(
    `INSERT INTO rate_limit (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}
