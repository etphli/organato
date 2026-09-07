/* global setTimeout */

import { CanvasBrowserError } from "./canvas-browser.mjs";
import {
  DeviceApiError,
  DeviceRevokedError,
  isExpired,
  ProtocolError,
  validateCanvasBaseUrl,
} from "./protocol.mjs";
import { VncRelay } from "./relay.mjs";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

function resultForError(error) {
  const code = error instanceof CanvasBrowserError ? error.code : "read_failed";
  const safeCode = ["login_required", "network_error", "read_failed"].includes(
    code,
  )
    ? code
    : "read_failed";
  return { status: "error", error: safeCode };
}

export class ConnectorService {
  constructor({
    state,
    apiBase,
    token,
    canvasBaseUrl,
    ssoAllowlist = [],
    profileDir,
    chromiumPath,
    display = ":99",
    client,
    browser,
    relay,
    logger = () => undefined,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    now = () => Date.now(),
  }) {
    this.state = state;
    this.apiBase = apiBase;
    this.token = token;
    this.canvasBaseUrl = canvasBaseUrl;
    this.ssoAllowlist = ssoAllowlist;
    this.profileDir = profileDir;
    this.chromiumPath = chromiumPath;
    this.display = display;
    this.client = client;
    this.browser = browser;
    this.relay = relay;
    this.logger = logger;
    this.sleep = sleep;
    this.pollIntervalMs = pollIntervalMs;
    this.now = now;
    this.running = false;
    this.revocationHandled = false;
    this.busy = false;
    this.backoffMs = pollIntervalMs;
  }

  async init() {
    await this.state.init();
    const credential = await this.state.loadCredential();
    if (!credential) throw new Error("not_paired");
    this.apiBase ??= credential.apiBase;
    this.token ??= credential.token;
    this.canvasBaseUrl ??= credential.canvasBaseUrl;
    if (!this.canvasBaseUrl)
      throw new ProtocolError("The paired Canvas origin is missing.");
    this.canvasBaseUrl = validateCanvasBaseUrl(this.canvasBaseUrl).origin;
    this.profileDir ??= this.state.profileDir;
    if (!this.client) {
      const { DeviceClient } = await import("./client.mjs");
      this.client = new DeviceClient({
        apiBase: this.apiBase,
        token: this.token,
        state: this.state,
        logger: this.logger,
      });
    }
    if (!this.browser) {
      const { CanvasBrowserAdapter } = await import("./canvas-browser.mjs");
      this.browser = new CanvasBrowserAdapter({
        canvasBaseUrl: this.canvasBaseUrl,
        ssoAllowlist: this.ssoAllowlist,
        profileDir: this.profileDir,
        executablePath: this.chromiumPath,
        display: this.display,
      });
    }
    if (!this.relay) {
      this.relay = new VncRelay({
        apiBase: this.apiBase,
        token: this.token,
        logger: this.logger,
      });
    }
    return this;
  }

  async runOnce() {
    if (this.revocationHandled) return { kind: "revoked" };
    if (this.busy) return { kind: "busy" };
    try {
      if (!(await this.client.flushPending())) return { kind: "pending" };
      const poll = await this.client.poll();
      await this.relay.update(poll.loginSession);
      this.backoffMs = this.pollIntervalMs;
      if (poll.command) {
        if (poll.command.canvasBaseUrl !== this.canvasBaseUrl) {
          throw new ProtocolError("The command Canvas origin changed.");
        }
        await this.processCommand(poll.command);
      }
      return { kind: poll.command ? "command" : "idle" };
    } catch (error) {
      if (error instanceof DeviceRevokedError) {
        await this.handleRevocation();
        return { kind: "revoked" };
      }
      if (error instanceof DeviceApiError) {
        this.logger("device_network_error");
      } else {
        this.logger("poll_protocol_error");
      }
      this.backoffMs = Math.min(
        MAX_BACKOFF_MS,
        Math.max(this.pollIntervalMs, this.backoffMs * 2),
      );
      return { kind: "retry", error };
    }
  }

  async processCommand(command) {
    if (this.busy) return;
    this.busy = true;
    this.logger(`command_started:${command.kind}`);
    let result;
    try {
      if (isExpired(command.expiresAt, this.now())) {
        result = { status: "error", error: "read_failed" };
      } else if (command.kind === "login") {
        await this.browser.openLogin();
        result = { status: "login_ready" };
      } else if (command.kind === "verify") {
        result = {
          status: "identity",
          identity: await this.browser.readIdentity(),
        };
      } else {
        const identity = await this.browser.readIdentity();
        const data = await this.browser.fetchUpcomingAssignments();
        result = { status: "sync", identity, data };
      }
    } catch (error) {
      result = resultForError(error);
    }
    try {
      await this.client.saveResult(command.id, result);
      await this.client.flushPending();
      this.logger(`command_finished:${command.kind}`);
    } catch (error) {
      if (error instanceof DeviceRevokedError) {
        await this.handleRevocation();
        throw error;
      }
      this.logger("result_pending");
    } finally {
      this.busy = false;
    }
  }

  async handleRevocation() {
    if (this.revocationHandled) return;
    this.revocationHandled = true;
    const revokedToken = this.client?.token;
    try {
      await this.relay?.stop();
    } catch {
      this.logger("revocation_relay_cleanup_failed");
    }
    try {
      await this.browser?.close();
    } catch {
      this.logger("revocation_browser_cleanup_failed");
    }
    let erased = false;
    try {
      await this.state.clearCredentialAndProfile();
      erased = true;
    } catch {
      this.logger("revocation_cleanup_failed");
    }
    if (erased && revokedToken) {
      try {
        this.client.token = revokedToken;
        await this.client.postErased();
        this.logger("erase_acknowledged");
      } catch {
        this.logger("erase_ack_failed");
      }
    }
    if (this.client) this.client.token = "";
    if (this.relay) this.relay.token = "";
    this.token = undefined;
    this.running = false;
    this.logger("device_revoked");
  }

  async start() {
    await this.init();
    this.running = true;
    while (this.running) {
      await this.runOnce();
      if (this.running) await this.sleep(this.backoffMs);
    }
  }

  async stop() {
    this.running = false;
    await this.relay?.stop();
    await this.browser?.close();
  }
}

export { DEFAULT_POLL_INTERVAL_MS, MAX_BACKOFF_MS, resultForError };
