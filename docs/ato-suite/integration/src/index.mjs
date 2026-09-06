const APP_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const TYPE_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const EVENT_TYPE_PATTERN =
  /^[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9-]{1,47}\.(created|updated|deleted|archived|restored)$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export const ATO_CONTRACT_VERSION = "1.0";
export const ATO_APPS = Object.freeze([
  "organato",
  "emailato",
  "calandato",
  "ato-centre",
]);

export class AtoContractError extends Error {
  constructor(issues) {
    super(`Invalid Ato contract: ${issues.join("; ")}`);
    this.name = "AtoContractError";
    this.issues = issues;
  }
}

function assertToken(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new AtoContractError([`${label} has an invalid format`]);
  }
  return value;
}

export function canonicalId(app, resourceType, localId) {
  assertToken(app, APP_PATTERN, "app");
  assertToken(resourceType, TYPE_PATTERN, "resourceType");
  assertToken(localId, LOCAL_ID_PATTERN, "localId");
  return `ato:${app}:${resourceType}:${localId}`;
}

export function parseCanonicalId(value) {
  if (typeof value !== "string") {
    throw new AtoContractError(["canonical ID must be a string"]);
  }
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "ato") {
    throw new AtoContractError([
      "canonical ID must be ato:<app>:<resource-type>:<local-id>",
    ]);
  }
  const [, app, resourceType, localId] = parts;
  assertToken(app, APP_PATTERN, "app");
  assertToken(resourceType, TYPE_PATTERN, "resourceType");
  assertToken(localId, LOCAL_ID_PATTERN, "localId");
  return { app, resourceType, localId };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateEventEnvelope(value) {
  const issues = [];
  if (!isPlainObject(value)) return ["envelope must be an object"];
  if (value.specVersion !== ATO_CONTRACT_VERSION)
    issues.push(`specVersion must be ${ATO_CONTRACT_VERSION}`);
  if (!UUID_PATTERN.test(String(value.id ?? "")))
    issues.push("id must be a UUID");
  if (!APP_PATTERN.test(String(value.source ?? "")))
    issues.push("source is invalid");
  if (!EVENT_TYPE_PATTERN.test(String(value.type ?? "")))
    issues.push("type is invalid");
  if (!RFC3339_PATTERN.test(String(value.occurredAt ?? "")))
    issues.push("occurredAt must be an RFC 3339 UTC timestamp");
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1)
    issues.push("sequence must be a positive safe integer");
  try {
    const subject = parseCanonicalId(value.subject);
    if (subject.app !== value.source)
      issues.push("subject app must equal source");
  } catch (error) {
    issues.push(
      ...(error instanceof AtoContractError
        ? error.issues
        : ["subject is invalid"]),
    );
  }
  if (!Number.isSafeInteger(value.resourceVersion) || value.resourceVersion < 1)
    issues.push("resourceVersion must be a positive safe integer");
  if (
    typeof value.traceId !== "string" ||
    value.traceId.length < 8 ||
    value.traceId.length > 128
  )
    issues.push("traceId must contain 8-128 characters");
  if (
    value.correlationId != null &&
    !UUID_PATTERN.test(String(value.correlationId))
  )
    issues.push("correlationId must be a UUID when present");
  if (!isPlainObject(value.data)) issues.push("data must be an object");
  if (
    value.dataClassification != null &&
    !["metadata", "personal", "sensitive"].includes(value.dataClassification)
  )
    issues.push("dataClassification is invalid");
  return issues;
}

export function createEventEnvelope(input, options = {}) {
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? (() => globalThis.crypto.randomUUID());
  const event = {
    specVersion: ATO_CONTRACT_VERSION,
    id: uuid(),
    source: input.source,
    type: input.type,
    occurredAt: now().toISOString(),
    sequence: input.sequence,
    subject: input.subject,
    resourceVersion: input.resourceVersion,
    traceId: input.traceId ?? uuid(),
    dataClassification: input.dataClassification ?? "personal",
    data: input.data,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
  const issues = validateEventEnvelope(event);
  if (issues.length) throw new AtoContractError(issues);
  return event;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export async function idempotencyKey(scope, value) {
  assertToken(scope, /^[a-z][a-z0-9-]{1,31}$/, "scope");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new globalThis.TextEncoder().encode(canonicalJson(value)),
  );
  return `${scope}:${bytesToBase64Url(new Uint8Array(digest))}`;
}

export function nextRetryDelay(attempt, options = {}) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new AtoContractError(["attempt must be a positive integer"]);
  }
  const baseMs = options.baseMs ?? 1_000;
  const capMs = options.capMs ?? 15 * 60_000;
  const jitter = options.jitter ?? Math.random();
  const exponential = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.floor(
    exponential * (0.5 + Math.min(1, Math.max(0, jitter)) * 0.5),
  );
}
