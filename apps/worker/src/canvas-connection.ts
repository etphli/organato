import {
  CanvasConnectionError,
  normalizeCanvasToken,
  validateBaseUrl,
} from "@organato/integrations";
import { z } from "zod";
import type { Env } from "./types";

export const canvasConnectSchema = z
  .object({
    token: z
      .string()
      .transform(normalizeCanvasToken)
      .pipe(z.string().min(10).max(500)),
  })
  .strict();

export interface CanvasConnectionMetadata {
  baseUrl: string;
  hostname: string;
  userId: string;
  userName: string;
  connectedAt: string;
  lastValidatedAt: string;
  credentialAad: string;
}

export function configuredCanvasInstallation(
  env: Pick<Env, "CANVAS_BASE_URL" | "CANVAS_DISPLAY_NAME">,
): {
  baseUrl: URL;
  name: string;
} {
  const configured = env.CANVAS_BASE_URL?.trim();
  if (!configured) {
    throw new Error("canvas_installation_not_configured");
  }
  const baseUrl = validateBaseUrl(configured);
  if (
    baseUrl.hostname === "canvas.example.edu" ||
    baseUrl.hostname.endsWith(".example.com")
  ) {
    throw new Error("canvas_installation_not_configured");
  }
  return {
    baseUrl,
    name: env.CANVAS_DISPLAY_NAME?.trim() || "Canvas",
  };
}

export function canvasCredentialAad(origin: string): string {
  return `integration:canvas:${origin}`;
}

export function createCanvasConnectionMetadata(input: {
  baseUrl: URL;
  userId: string;
  userName: string;
  now: string;
}): CanvasConnectionMetadata {
  return {
    baseUrl: input.baseUrl.origin,
    hostname: input.baseUrl.hostname,
    userId: input.userId,
    userName: input.userName,
    connectedAt: input.now,
    lastValidatedAt: input.now,
    credentialAad: canvasCredentialAad(input.baseUrl.origin),
  };
}

export function parseCanvasConnectionMetadata(
  value: string,
  accountLabel = "",
): CanvasConnectionMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<CanvasConnectionMetadata>;
    const baseUrl = validateBaseUrl(parsed.baseUrl ?? "");
    const fallbackUserName = accountLabel.split(" · ")[0]?.trim();
    const userName = parsed.userName?.trim() || fallbackUserName;
    if (!userName) return null;
    const connectedAt =
      parsed.connectedAt ?? parsed.lastValidatedAt ?? new Date(0).toISOString();
    return {
      baseUrl: baseUrl.origin,
      hostname: baseUrl.hostname,
      userId: parsed.userId ?? "",
      userName,
      connectedAt,
      lastValidatedAt: parsed.lastValidatedAt ?? connectedAt,
      credentialAad:
        parsed.credentialAad ??
        `integration:canvas:${parsed.hostname ?? baseUrl.hostname}`,
    };
  } catch {
    return null;
  }
}

export function nextHourlySyncAt(now = new Date()): string {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString();
}

export function safeCanvasConnectionError(error: unknown): string {
  if (error instanceof CanvasConnectionError) {
    if (error.code === "token_rejected") {
      return "Reshet says this token is invalid or expired. Copy the full token value shown when it is created (not the token ID), then try once.";
    }
    if (error.code === "api_access_denied") {
      return "Emanuel Canvas denied the read-only API access Organato needs. The token must allow GET /api/v1/courses and GET /api/v1/courses/:course_id/assignments. If those scopes are unavailable, ask the school's Canvas administrator to allow them; another token with the same restrictions will fail too.";
    }
    if (
      error.code === "unexpected_origin" ||
      error.code === "unexpected_redirect"
    ) {
      return "Reshet returned an unexpected address, so Organato stopped before sending credentials.";
    }
    if (error.code === "invalid_response") {
      return "Reshet returned an unexpected response. Nothing was stored.";
    }
    if (error.code === "rate_limited") {
      return "Reshet asked Organato to slow down. Wait a minute, then try again.";
    }
    if (error.code === "response_too_large") {
      return "Reshet returned more data than Organato could safely validate. Nothing was stored.";
    }
    if (error.code === "pagination_limit") {
      return "Reshet returned an incomplete course list. Nothing was stored; try again shortly.";
    }
    if (error.code === "request_failed" && error.status) {
      return `Reshet rejected the validation request (HTTP ${error.status}). Nothing was stored.`;
    }
  }
  if (
    error instanceof Error &&
    error.message === "canvas_installation_not_configured"
  ) {
    return "The Reshet installation is not configured for this deployment.";
  }
  return "Organato could not reach Reshet. Nothing was stored; try again shortly.";
}

export function canvasConnectionErrorCategory(error: unknown): string {
  if (error instanceof CanvasConnectionError) {
    return error.status ? `${error.code}_${error.status}` : error.code;
  }
  if (
    error instanceof Error &&
    error.message === "canvas_installation_not_configured"
  ) {
    return "installation_not_configured";
  }
  return "unexpected_failure";
}

export function canvasConnectionErrorCode(error: unknown): string {
  if (error instanceof CanvasConnectionError) return error.code;
  if (
    error instanceof Error &&
    error.message === "canvas_installation_not_configured"
  ) {
    return "installation_not_configured";
  }
  return "unexpected_failure";
}
