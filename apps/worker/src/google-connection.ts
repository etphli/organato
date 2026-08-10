import { GoogleCalendarRestProvider } from "@organato/integrations";
import { decryptSecret } from "./security";
import type { Env } from "./types";

export interface GoogleMetadata {
  email: string;
  calendarId?: string;
  syncToken?: string;
  recipients?: string[];
}

export interface GoogleDeliverySettings {
  connected: boolean;
  sender: string | null;
  recipients: string[];
  status: string;
  reconnectNeeded: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCategory: string | null;
}

export class GoogleConnectionError extends Error {
  constructor(
    readonly code: "not_connected" | "authorization_failed",
    message: string,
  ) {
    super(message);
    this.name = "GoogleConnectionError";
  }
}

function parseMetadata(value: string): GoogleMetadata | null {
  try {
    const metadata = JSON.parse(value) as Partial<GoogleMetadata>;
    if (!metadata.email?.trim()) return null;
    return {
      email: metadata.email.trim().toLowerCase(),
      ...(metadata.calendarId ? { calendarId: metadata.calendarId } : {}),
      ...(metadata.syncToken ? { syncToken: metadata.syncToken } : {}),
      recipients: Array.isArray(metadata.recipients)
        ? metadata.recipients
            .map((recipient) => recipient.trim().toLowerCase())
            .filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

export async function getGoogleDeliverySettings(
  env: Pick<Env, "DB">,
  workspaceId: string,
): Promise<GoogleDeliverySettings> {
  const row = await env.DB.prepare(
    `SELECT encrypted_credential, metadata_json, status, reconnect_needed,
            last_success_at, last_attempt_at, last_error_category
     FROM integration_connection WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(workspaceId)
    .first<{
      encrypted_credential: string | null;
      metadata_json: string;
      status: string;
      reconnect_needed: number;
      last_success_at: string | null;
      last_attempt_at: string | null;
      last_error_category: string | null;
    }>();
  const metadata = row ? parseMetadata(row.metadata_json) : null;
  const connected = Boolean(
    row?.encrypted_credential &&
    row.status !== "disconnected" &&
    metadata?.email,
  );
  return {
    connected,
    sender: connected && metadata ? metadata.email : null,
    recipients:
      connected && metadata
        ? metadata.recipients?.length
          ? metadata.recipients
          : [metadata.email]
        : [],
    status: connected ? (row?.status ?? "action_needed") : "disconnected",
    reconnectNeeded: Boolean(row?.reconnect_needed),
    lastSuccessAt: row?.last_success_at ?? null,
    lastAttemptAt: row?.last_attempt_at ?? null,
    lastErrorCategory: row?.last_error_category ?? null,
  };
}

export async function updateGoogleRecipients(
  env: Pick<Env, "DB">,
  workspaceId: string,
  recipients: string[],
): Promise<GoogleDeliverySettings> {
  const row = await env.DB.prepare(
    `SELECT metadata_json, encrypted_credential, status
     FROM integration_connection WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(workspaceId)
    .first<{
      metadata_json: string;
      encrypted_credential: string | null;
      status: string;
    }>();
  const metadata = row ? parseMetadata(row.metadata_json) : null;
  if (
    !row?.encrypted_credential ||
    row.status === "disconnected" ||
    !metadata
  ) {
    throw new Error("google_not_connected");
  }
  await env.DB.prepare(
    `UPDATE integration_connection
     SET metadata_json = ?, updated_at = ?
     WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(
      JSON.stringify({ ...metadata, recipients }),
      new Date().toISOString(),
      workspaceId,
    )
    .run();
  return getGoogleDeliverySettings(env, workspaceId);
}

export async function loadGoogleConnection(env: Env, workspaceId: string) {
  const row = await env.DB.prepare(
    `SELECT encrypted_credential, metadata_json, status
     FROM integration_connection WHERE workspace_id = ? AND provider = 'google'`,
  )
    .bind(workspaceId)
    .first<{
      encrypted_credential: string;
      metadata_json: string;
      status: string;
    }>();
  if (!row?.encrypted_credential || row.status === "disconnected") return null;
  const metadata = parseMetadata(row.metadata_json);
  if (!metadata) return null;
  const refreshToken = await decryptSecret(
    row.encrypted_credential,
    env.DATA_ENCRYPTION_KEY,
    `integration:google:${metadata.email}`,
  );
  let cached: { value: string; expiresAt: number } | null = null;
  const tokenSource = {
    async accessToken() {
      if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!response.ok) {
        throw new GoogleConnectionError(
          "authorization_failed",
          "Google authorization needs reconnection.",
        );
      }
      const value = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };
      cached = {
        value: value.access_token,
        expiresAt: Date.now() + value.expires_in * 1_000,
      };
      return cached.value;
    },
  };
  return {
    metadata,
    tokenSource,
    calendar: new GoogleCalendarRestProvider(tokenSource),
  };
}
