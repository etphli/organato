/* global URL */

import dns from "node:dns/promises";
import net from "node:net";

export const DEFAULT_API_BASE = "https://organato.etphli.workers.dev";
export const MAX_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_RESULT_BYTES = 3_000_000;
export const MAX_ORIGIN_LIST_ENTRIES = 16;
export const DEFAULT_SSO_ALLOWLIST = Object.freeze([
  "https://emanuelschool-login.cloudworkengine.net",
  "https://emanuel.files.cloudworkengine.net.au",
  "https://theme.files.cloudworkengine.net.au",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://ssl.gstatic.com",
]);

export class ProtocolError extends Error {
  constructor(message, code = "protocol_error") {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export class DeviceApiError extends Error {
  constructor(status, code = "device_request_failed") {
    super(code);
    this.name = "DeviceApiError";
    this.status = status;
    this.code = code;
  }
}

export class DeviceRevokedError extends DeviceApiError {
  constructor(status) {
    super(status, "device_revoked");
    this.name = "DeviceRevokedError";
  }
}

export class StaleCommandError extends DeviceApiError {
  constructor() {
    super(409, "stale_command");
    this.name = "StaleCommandError";
  }
}

function asTrimmedString(value, label, maximum = 500) {
  if (typeof value !== "string") {
    throw new ProtocolError(`${label} must be text.`);
  }
  const result = value.trim();
  if (!result || result.length > maximum) {
    throw new ProtocolError(`${label} is outside the safe size limit.`);
  }
  return result;
}

function isPrivateIpv4(host) {
  const octets = host.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isPublicResolvedAddress(address) {
  return (
    typeof address === "string" &&
    net.isIP(address) !== 0 &&
    !isPrivateAddress(address)
  );
}

function parseIpv6(host) {
  const value = host.toLowerCase();
  if (value.includes("%")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const parsePart = (part) => {
    if (!part) return [];
    const pieces = part.split(":");
    const expanded = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const octets = piece.split(".").map(Number);
        if (
          octets.length !== 4 ||
          octets.some(
            (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
          )
        ) {
          return null;
        }
        expanded.push(
          ((octets[0] << 8) | octets[1]).toString(16),
          ((octets[2] << 8) | octets[3]).toString(16),
        );
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        expanded.push(piece);
      }
    }
    return expanded;
  };
  const left = parsePart(halves[0]);
  if (!left) return null;
  const right = halves.length === 2 ? parsePart(halves[1]) : [];
  if (!right) return null;
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (zeros < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const pieces = [
    ...left,
    ...Array.from({ length: zeros }, () => "0"),
    ...right,
  ];
  if (pieces.length !== 8) return null;
  return pieces.reduce(
    (result, piece) => (result << 16n) | BigInt(`0x${piece}`),
    0n,
  );
}

export function isPrivateAddress(hostname) {
  const host = String(hostname)
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return isPrivateIpv4(host);
  }

  if (ipVersion === 6) {
    const address = parseIpv6(host);
    if (address === null) return true;
    const prefix8 = address >> 120n;
    const prefix10 = address >> 118n;
    const prefix32 = address >> 96n;
    if (
      address === 0n ||
      address === 1n ||
      prefix8 === 0xffn ||
      prefix10 === 0b1111111010n ||
      prefix10 >> 3n === 0b1111110n ||
      prefix32 === 0x20010db8n
    ) {
      return true;
    }
    if (address >> 32n === 0xffffn || address >> 32n === 0n) {
      const mapped = Number(address & 0xffffffffn);
      const mappedHost = [
        mapped >>> 24,
        (mapped >>> 16) & 255,
        (mapped >>> 8) & 255,
        mapped & 255,
      ].join(".");
      return isPrivateIpv4(mappedHost);
    }
    return false;
  }

  return false;
}

function parseHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProtocolError(`${label} must be a valid HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/") ||
    isPrivateAddress(url.hostname)
  ) {
    throw new ProtocolError(`${label} must be a public HTTPS origin.`);
  }
  url.pathname = "/";
  return url;
}

export function validateApiBase(value = DEFAULT_API_BASE) {
  return parseHttpsOrigin(value, "API base");
}

export function validateCanvasBaseUrl(value) {
  return parseHttpsOrigin(value, "Canvas base URL");
}

export function parseSsoAllowlist(value = "") {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const origins = DEFAULT_SSO_ALLOWLIST.map((entry) => new URL(entry).origin);
  for (const entry of entries) {
    const origin = parseHttpsOrigin(entry, "SSO allowlist entry").origin;
    if (!origins.includes(origin)) {
      origins.push(origin);
      if (origins.length > MAX_ORIGIN_LIST_ENTRIES) {
        throw new ProtocolError("The SSO allowlist is too large.");
      }
    }
  }
  return origins;
}

export function normalizeSsoAllowlist(value = []) {
  if (!Array.isArray(value))
    throw new ProtocolError("The SSO allowlist is malformed.");
  return parseSsoAllowlist(value.join(","));
}

export function isSafeDestinationUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !isPrivateAddress(url.hostname)
    );
  } catch {
    return false;
  }
}

export class DestinationPolicy {
  constructor({ canvasBaseUrl, ssoAllowlist = [], lookup = dns.lookup } = {}) {
    const canvas = validateCanvasBaseUrl(canvasBaseUrl);
    this.canvasOrigin = canvas.origin;
    this.allowedOrigins = new Set([
      this.canvasOrigin,
      ...normalizeSsoAllowlist(ssoAllowlist),
    ]);
    this.lookup = lookup;
    this.safeHostCache = new Map();
  }

  async assertAllowedOrigins() {
    for (const origin of this.allowedOrigins) {
      if (!(await this.isAllowed(origin))) {
        throw new ProtocolError(
          "An allowed browser origin could not be resolved safely.",
        );
      }
    }
  }

  isNavigationAllowed(value) {
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        (url.origin === this.canvasOrigin ||
          url.origin === "https://emanuelschool-login.cloudworkengine.net")
      );
    } catch {
      return false;
    }
  }

  isWriteAllowed(value, method = "GET") {
    const normalizedMethod = String(method ?? "GET").toUpperCase();
    if (["GET", "HEAD"].includes(normalizedMethod)) return true;
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !this.allowedOrigins.has(url.origin)
    ) {
      return false;
    }
    return url.origin !== this.canvasOrigin || isCanvasAuthPath(url.pathname);
  }

  async isAllowed(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (
      url.protocol === "file:" ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isPrivateAddress(url.hostname) ||
      !this.allowedOrigins.has(url.origin)
    ) {
      return false;
    }

    const cached = this.safeHostCache.get(url.hostname);
    if (cached && cached.expiresAt > Date.now()) return cached.safe;

    let addresses;
    try {
      addresses = await this.lookup(url.hostname, {
        all: true,
        verbatim: true,
      });
    } catch {
      this.safeHostCache.set(url.hostname, {
        safe: false,
        expiresAt: Date.now() + 60_000,
      });
      return false;
    }
    const safe =
      Array.isArray(addresses) &&
      addresses.length > 0 &&
      addresses.every(({ address }) => isPublicResolvedAddress(address));
    this.safeHostCache.set(url.hostname, {
      safe,
      expiresAt: Date.now() + 60_000,
    });
    return safe;
  }
}

function requestProperty(request, name) {
  const value = request?.[name];
  return typeof value === "function" ? value.call(request) : value;
}

export function isApiWriteRequest(request) {
  const method = String(
    requestProperty(request, "method") ?? "GET",
  ).toUpperCase();
  let url;
  try {
    url = new URL(requestProperty(request, "url") ?? "");
  } catch {
    return true;
  }
  const pathname = url.pathname.toLowerCase();
  return (
    (pathname === "/api" || pathname.startsWith("/api/")) &&
    !["GET", "HEAD"].includes(method)
  );
}

const CANVAS_AUTH_PATHS = [
  /^\/login(?:\/|$)/,
  /^\/logout(?:\/|$)/,
  /^\/saml(?:\/|$)/,
  /^\/sso(?:\/|$)/,
  /^\/users\/login$/,
];

function isCanvasAuthPath(pathname) {
  return CANVAS_AUTH_PATHS.some((pattern) => pattern.test(pathname));
}

export function isAllowedWriteRequest(
  value,
  method,
  canvasOrigin,
  ssoOrigins = [],
) {
  const normalizedMethod = String(method ?? "GET").toUpperCase();
  if (["GET", "HEAD"].includes(normalizedMethod)) return true;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.origin === canvasOrigin) return isCanvasAuthPath(url.pathname);
  return normalizeSsoAllowlist(ssoOrigins).includes(url.origin);
}

export function parseIsoExpiry(value, label = "expiresAt") {
  const text = asTrimmedString(value, label, 80);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) {
    throw new ProtocolError(`${label} must be an ISO timestamp.`);
  }
  return text;
}

export function isExpired(value, now = Date.now()) {
  return Date.parse(value) <= now;
}

function parseLoginSession(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The device login session is malformed.");
  }
  return {
    id: asTrimmedString(value.id, "loginSession.id", 200),
    expiresAt: parseIsoExpiry(value.expiresAt, "loginSession.expiresAt"),
  };
}

function parseCommand(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The device command is malformed.");
  }
  const canvasBaseUrl = validateCanvasBaseUrl(
    asTrimmedString(value.canvasBaseUrl, "command.canvasBaseUrl", 500),
  ).origin;
  const kind = asTrimmedString(value.kind, "command.kind", 20);
  if (!["login", "verify", "sync"].includes(kind)) {
    throw new ProtocolError("The device command kind is unsupported.");
  }
  return {
    id: asTrimmedString(value.id, "command.id", 100),
    kind,
    expiresAt: parseIsoExpiry(value.expiresAt, "command.expiresAt"),
    canvasBaseUrl,
  };
}

export function parsePollResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The device poll response is malformed.");
  }
  return {
    command: parseCommand(value.command ?? null),
    loginSession: parseLoginSession(value.loginSession ?? null),
  };
}

export function parsePairResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProtocolError("The pairing response is malformed.");
  }
  const token = asTrimmedString(value.token, "pairing token", 100);
  if (!/^[A-Za-z0-9_-]{64}$/.test(token)) {
    throw new ProtocolError("The pairing token has an unexpected format.");
  }
  return {
    token,
    canvasBaseUrl: validateCanvasBaseUrl(
      asTrimmedString(value.canvasBaseUrl, "canvasBaseUrl", 500),
    ).origin,
    workspaceId: asTrimmedString(value.workspaceId, "workspaceId", 200),
  };
}

export function parseJsonText(text, label = "response") {
  if (typeof text !== "string" || text.length > MAX_JSON_BYTES) {
    throw new ProtocolError(`${label} exceeded the safe response limit.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProtocolError(`${label} was not valid JSON.`);
  }
}

export function buildResult(commandId, body) {
  const id = asTrimmedString(commandId, "commandId", 100);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ProtocolError("The command result is malformed.");
  }
  return { ...body, commandId: id };
}

export async function assertPublicOriginResolution(
  value,
  label,
  lookup = dns.lookup,
) {
  const url = parseHttpsOrigin(value, label);
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ProtocolError(`${label} could not be resolved safely.`);
  }
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicResolvedAddress(address))
  ) {
    throw new ProtocolError(`${label} resolved to a private network address.`);
  }
  return url;
}
