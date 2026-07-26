import { GoogleCalendarRestProvider } from "@organato/integrations";
import { decryptSecret } from "./security";
import type { Env } from "./types";

interface GoogleMetadata {
  email: string;
  calendarId?: string;
  syncToken?: string;
  recipients?: string[];
}

export async function loadGoogleConnection(env: Env) {
  const row = await env.DB.prepare(
    `SELECT encrypted_credential, metadata_json, status
     FROM integration_connection WHERE provider = 'google'`,
  ).first<{
    encrypted_credential: string;
    metadata_json: string;
    status: string;
  }>();
  if (!row?.encrypted_credential || row.status === "disconnected") return null;
  const metadata = JSON.parse(row.metadata_json) as GoogleMetadata;
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
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      });
      if (!response.ok)
        throw new Error("Google authorization needs reconnection.");
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
