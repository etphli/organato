import {
  CanvasConnectionError,
  normalizeCanvasCookie,
  validateBaseUrl,
} from "@organato/integrations";
import { z } from "zod";
import type { Env } from "./types";

export const canvasConnectSchema = z
  .object({
    cookie: z
      .string()
      .transform(normalizeCanvasCookie)
      .pipe(
        z
          .string()
          .min(10)
          .max(4000)
          .refine(
            (value) =>
              ![...value].some((character) => {
                const code = character.charCodeAt(0);
                return code < 32 || code === 127;
              }),
            { message: "Cookie must be a single header value." },
          ),
      ),
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
  transport?: "browser";
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
      ...(parsed.transport === "browser"
        ? { transport: parsed.transport }
        : {}),
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
    if (error.code === "session_rejected") {
      return "Reshet ended this browser session. Sign in to Reshet in your browser, copy the fresh Cookie value from the network tab, and reconnect.";
    }
    if (error.code === "api_access_denied") {
      return "Emanuel Canvas denied the read-only API access Organato needs while signed in as you. Confirm you can open Courses and an assignment list in a private browser window, then try again. If it still fails, ask the school's Canvas administrator to allow student access to GET /api/v1/courses and GET /api/v1/courses/:course_id/assignments.";
    }
    if (error.code === "edge_blocked") {
      return "The school's Canvas firewall blocked this request before it reached Canvas. Try again in a minute; if it keeps happening, send the sanitized diagnostic to the owner.";
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
