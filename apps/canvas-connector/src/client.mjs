/* global URL, AbortController, TextEncoder, setTimeout, clearTimeout */

import {
  DeviceApiError,
  DeviceRevokedError,
  StaleCommandError,
  MAX_JSON_BYTES,
  MAX_RESULT_BYTES,
  ProtocolError,
  buildResult,
  parseJsonText,
  parsePairResponse,
  parsePollResponse,
  validateApiBase,
} from "./protocol.mjs";

export const DEVICE_REQUEST_TIMEOUT_MS = 30_000;
export const RESULT_UPLOAD_TIMEOUT_MS = 120_000;

async function boundedJson(response, label) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) {
    throw new ProtocolError(`${label} exceeded the safe response limit.`);
  }
  const text = await response.text();
  return parseJsonText(text, label);
}

function authHeaders(token, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function isTransientUploadError(error) {
  return (
    error instanceof DeviceApiError &&
    (error.status === 0 || error.status === 429 || error.status >= 500)
  );
}

export class DeviceClient {
  constructor({
    apiBase,
    token,
    state,
    fetcher = globalThis.fetch,
    logger = () => undefined,
  }) {
    this.apiBase = validateApiBase(apiBase);
    if (typeof token !== "string" || !token.trim())
      throw new ProtocolError("A device token is required.");
    this.token = token;
    this.state = state;
    this.fetcher = fetcher;
    this.logger = logger;
  }

  endpoint(pathname) {
    const url = new URL(pathname, this.apiBase);
    if (url.origin !== this.apiBase.origin)
      throw new ProtocolError("The device endpoint escaped its API origin.");
    return url;
  }

  async request(
    pathname,
    { method = "GET", body, timeoutMs = DEVICE_REQUEST_TIMEOUT_MS } = {},
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    let response;
    try {
      response = await this.fetcher(this.endpoint(pathname).href, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: authHeaders(
          this.token,
          body === undefined ? {} : { "Content-Type": "application/json" },
        ),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new DeviceApiError(
        0,
        error?.name === "AbortError" ? "timeout" : "network_error",
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 || response.status === 410)
      throw new DeviceRevokedError(response.status);
    if (response.status === 409) throw new StaleCommandError();
    if (response.status >= 300 && response.status < 400)
      throw new DeviceApiError(response.status, "unexpected_redirect");
    if (!response.ok) throw new DeviceApiError(response.status);
    return response;
  }

  async poll() {
    const response = await this.request("/api/canvas-device/poll", {
      method: "POST",
      body: {},
    });
    return parsePollResponse(
      await boundedJson(response, "device poll response"),
    );
  }

  async postResult(result) {
    let encoded;
    try {
      encoded = JSON.stringify(result);
    } catch {
      throw new DeviceApiError(413);
    }
    if (typeof encoded !== "string") throw new DeviceApiError(400);
    if (new TextEncoder().encode(encoded).byteLength > MAX_RESULT_BYTES)
      throw new DeviceApiError(413);
    const response = await this.request("/api/canvas-device/result", {
      method: "POST",
      body: result,
      timeoutMs: RESULT_UPLOAD_TIMEOUT_MS,
    });
    const value = await boundedJson(response, "device result response");
    if (!value || value.ok !== true)
      throw new ProtocolError(
        "The device result acknowledgement was malformed.",
      );
    return value;
  }

  async postErased() {
    const response = await this.request("/api/canvas-device/erased", {
      method: "POST",
      body: {},
    });
    const value = await boundedJson(response, "device erase acknowledgement");
    if (!value || value.ok !== true)
      throw new ProtocolError(
        "The device erase acknowledgement was malformed.",
      );
    return value;
  }

  async saveResult(commandId, result) {
    await this.state.savePending(commandId, buildResult(commandId, result));
  }

  async flushPending() {
    const pending = await this.state.loadPending();
    if (!pending) return true;
    const result = { ...pending.result, commandId: pending.commandId };
    try {
      await this.postResult(result);
    } catch (error) {
      if (error instanceof StaleCommandError) {
        await this.state.clearPending();
        this.logger("stale_result_dropped");
        return true;
      }
      if (
        error instanceof DeviceApiError &&
        [400, 413].includes(error.status)
      ) {
        const fallback = buildResult(pending.commandId, {
          status: "error",
          error: "read_failed",
        });
        await this.state.savePending(pending.commandId, fallback);
        try {
          await this.postResult(fallback);
        } catch (fallbackError) {
          if (fallbackError instanceof StaleCommandError) {
            await this.state.clearPending();
            this.logger("stale_result_dropped");
            return true;
          }
          if (
            fallbackError instanceof DeviceApiError &&
            [400, 413].includes(fallbackError.status)
          ) {
            await this.state.clearPending();
            this.logger("invalid_result_dropped");
            return true;
          }
          if (fallbackError instanceof DeviceRevokedError) throw fallbackError;
          if (isTransientUploadError(fallbackError)) throw fallbackError;
          await this.state.clearPending();
          this.logger("invalid_result_dropped");
          return true;
        }
        await this.state.clearPending();
        this.logger("invalid_result_replaced");
        return true;
      }
      if (
        isTransientUploadError(error) ||
        error instanceof DeviceRevokedError
      ) {
        throw error;
      }
      await this.state.clearPending();
      this.logger("invalid_result_dropped");
      return true;
    }
    await this.state.clearPending();
    this.logger("result_acknowledged");
    return true;
  }
}

export async function pairDevice({
  apiBase,
  code,
  name,
  state,
  fetcher = globalThis.fetch,
}) {
  const base = validateApiBase(apiBase);
  const normalizedCode = typeof code === "string" ? code.trim() : "";
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(normalizedCode)) {
    throw new ProtocolError("The pairing code is malformed.");
  }
  const normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName || normalizedName.length > 80) {
    throw new ProtocolError("The device name is malformed.");
  }
  let response;
  try {
    response = await fetcher(new URL("/api/canvas-device/pair", base).href, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: normalizedCode, name: normalizedName }),
    });
  } catch {
    throw new DeviceApiError(0, "network_error");
  }
  if (response.status >= 300 && response.status < 400)
    throw new DeviceApiError(response.status, "unexpected_redirect");
  if (!response.ok) throw new DeviceApiError(response.status);
  const paired = parsePairResponse(
    await boundedJson(response, "pairing response"),
  );
  await state.saveCredential({
    token: paired.token,
    apiBase: base.origin,
    canvasBaseUrl: paired.canvasBaseUrl,
    workspaceId: paired.workspaceId,
    pairedAt: new Date().toISOString(),
  });
  return {
    canvasBaseUrl: paired.canvasBaseUrl,
    workspaceId: paired.workspaceId,
  };
}

export { boundedJson };
