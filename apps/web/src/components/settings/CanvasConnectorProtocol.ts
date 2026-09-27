import {
  parseCanvasSyncSummary,
  type CanvasSyncSummary,
} from "../../lib/canvasSync";
import { IntegrationRequestError } from "../../lib/integrationApi";

const connectorStates = [
  "unpaired",
  "offline",
  "ready",
  "signing_in",
  "awaiting_confirmation",
  "connected",
  "login_required",
  "syncing",
  "error",
] as const;

export type CanvasConnectorState = (typeof connectorStates)[number];

export interface CanvasConnectorIdentity {
  id: string;
  name: string;
  hostname: string;
}

export interface CanvasConnectorStatus {
  enabled: boolean;
  paired: boolean;
  erasurePending: boolean;
  deviceName: string | null;
  lastSeenAt: string | null;
  state: CanvasConnectorState;
  identity: CanvasConnectorIdentity | null;
  candidateIdentity: CanvasConnectorIdentity | null;
  lastSyncAt: string | null;
  lastSync?: CanvasSyncSummary | null;
  error: string | null;
  loginExpiresAt: string | null;
}

export interface CanvasPairResponse {
  code: string;
  expiresAt: string;
}

export interface CanvasViewResponse {
  url: string;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} returned an invalid response.`);
  }
  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} returned an invalid ${key}.`);
  }
  return value;
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${context} returned an invalid ${key}.`);
  }
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new Error(`${context} returned an invalid ${key}.`);
  }
  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  context: string,
): boolean {
  const value = record[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new Error(`${context} returned an invalid ${key}.`);
  }
  return value;
}

function parseState(value: unknown): CanvasConnectorState {
  for (const state of connectorStates) {
    if (value === state) return state;
  }
  throw new Error("Canvas connector returned an invalid state.");
}

function parseIdentity(
  value: unknown,
  context: string,
): CanvasConnectorIdentity | null {
  if (value === null) return null;
  const record = asRecord(value, context);
  return {
    id: requiredString(record, "id", context),
    name: requiredString(record, "name", context),
    hostname: requiredString(record, "hostname", context),
  };
}

export function parseCanvasConnectorStatus(
  value: unknown,
): CanvasConnectorStatus {
  const record = asRecord(value, "Canvas connector status");
  return {
    enabled: requiredBoolean(record, "enabled", "Canvas connector status"),
    paired: requiredBoolean(record, "paired", "Canvas connector status"),
    erasurePending: optionalBoolean(
      record,
      "erasurePending",
      "Canvas connector status",
    ),
    deviceName: nullableString(record, "deviceName", "Canvas connector status"),
    lastSeenAt: nullableString(record, "lastSeenAt", "Canvas connector status"),
    state: parseState(record.state),
    identity: parseIdentity(record.identity, "Canvas connector identity"),
    candidateIdentity: parseIdentity(
      record.candidateIdentity,
      "Canvas candidate identity",
    ),
    lastSyncAt: nullableString(record, "lastSyncAt", "Canvas connector status"),
    lastSync: record.lastSync ? parseCanvasSyncSummary(record.lastSync) : null,
    error: nullableString(record, "error", "Canvas connector status"),
    loginExpiresAt: nullableString(
      record,
      "loginExpiresAt",
      "Canvas connector status",
    ),
  };
}

export function parseSessionSecurity(value: unknown): boolean {
  const record = asRecord(value, "Session security");
  return requiredBoolean(record, "recentAuthentication", "Session security");
}

export function parsePairResponse(value: unknown): CanvasPairResponse {
  const record = asRecord(value, "Canvas connector pairing");
  return {
    code: requiredString(record, "code", "Canvas connector pairing"),
    expiresAt: requiredString(record, "expiresAt", "Canvas connector pairing"),
  };
}

export function parseViewResponse(value: unknown): CanvasViewResponse {
  const record = asRecord(value, "Canvas sign-in browser");
  const url = requiredString(record, "url", "Canvas sign-in browser");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Canvas sign-in browser returned an invalid URL.");
  }
  if (parsedUrl.protocol !== "wss:") {
    throw new Error("Canvas sign-in browser returned an insecure URL.");
  }
  return {
    url,
    expiresAt: requiredString(record, "expiresAt", "Canvas sign-in browser"),
  };
}

export function parseOkResponse(value: unknown, context: string): void {
  const record = asRecord(value, context);
  if (record.ok !== true) {
    throw new Error(`${context} did not complete.`);
  }
}

export function requestErrorMessage(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback;
}

export function requiresRecentAuthentication(value: unknown): boolean {
  if (!(value instanceof IntegrationRequestError)) return false;
  return (
    value.code === "reauthentication_required" ||
    value.code === "recent_authentication_required" ||
    value.code === "recent_auth_required"
  );
}

export function canvasConnectorIsConnected(
  status: CanvasConnectorStatus,
): boolean {
  return (
    (status.state === "connected" || status.state === "syncing") &&
    status.identity !== null
  );
}
