import { z } from "zod";
import { createCanvasConnectionMetadata } from "./canvas-connection";
import {
  connectorResultSchema,
  type ConnectorState,
  type ConnectorCommand,
} from "./canvas-connector-contract";
import { randomToken, sha256, recordSecurityEvent } from "./security";
import {
  runCanvasSync,
  runCalendarReconciliation,
  sendUrgentImport,
} from "./sync";
import type { Env } from "./types";

const json = (value: unknown, status = 200) => Response.json(value, { status });
const fail = (error: string, status = 409) => json({ error }, status);
const bindingSchema = z
  .object({
    workspaceId: z.string().min(1),
    deviceKey: z.string().length(43),
    baseUrl: z.string().url(),
    deviceName: z.string().min(1).max(80),
  })
  .strict();
const ticketSchema = z.object({
  hash: z.string(),
  sessionId: z.string(),
  expiresAt: z.number(),
});
const attachmentSchema = z.object({
  role: z.enum(["device", "viewer"]),
  receivedData: z.boolean().optional(),
  sessionId: z.string(),
  expiresAt: z.number(),
});

export class CanvasConnector {
  private pending: Promise<unknown> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => undefined);
    return next;
  }
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    // Serialize account changes with imports, so disconnect cannot race a database write.
    return this.serialize(async () => {
      try {
        return await this.handle(request);
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
          return fail("Invalid connector request.", 400);
        return fail(
          "The connector could not finish this operation. Try again.",
          503,
        );
      }
    });
  }

  private diagnostic(
    state: ConnectorState,
    stage: string,
    details: Record<string, string | number> = {},
  ) {
    this.ctx.waitUntil(
      recordSecurityEvent(
        this.env.DB,
        "canvas_connector",
        state.workspaceId,
        JSON.stringify({
          stage,
          sessionId: state.loginSession?.id ?? null,
          ...details,
        }),
      ).catch(() => undefined),
    );
  }

  private async save(state: ConnectorState) {
    await this.ctx.storage.put("state", state);
  }

  private command(state: ConnectorState, kind: ConnectorCommand["kind"]) {
    state.command = {
      id: crypto.randomUUID(),
      kind,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      canvasBaseUrl: state.baseUrl,
    };
  }

  private async closeView(state: ConnectorState) {
    state.loginSession = null;
    await this.ctx.storage.delete("ticket");
    await this.ctx.storage.deleteAlarm();
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Sign-in ended");
  }

  private async expire(state: ConnectorState) {
    if (
      state.loginSession &&
      Date.parse(state.loginSession.expiresAt) <= Date.now()
    ) {
      await this.closeView(state);
      state.candidateIdentity = null;
      state.command = null;
      state.phase = state.identity ? "login_required" : "ready";
      state.error = "Sign-in timed out. Open Connect Canvas to try again.";
    }
    if (state.command && Date.parse(state.command.expiresAt) <= Date.now()) {
      state.command = null;
      state.phase = state.loginSession ? "signing_in" : "error";
      state.error = "The connector did not finish in time. Try again.";
      state.nextSyncAt = Date.now() + 5 * 60_000;
    }
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/bind") {
      const input = bindingSchema.parse(await request.json());
      for (const ws of this.ctx.getWebSockets())
        ws.close(1000, "Connector replaced");
      await this.ctx.storage.deleteAll();
      const state: ConnectorState = {
        ...input,
        paired: true,
        lastSeenAt: new Date().toISOString(),
        phase: "ready",
        identity: null,
        candidateIdentity: null,
        lastSyncAt: null,
        error: null,
        loginSession: null,
        command: null,
        completed: [],
        nextSyncAt: 0,
      };
      await this.save(state);
      return json({ ok: true });
    }
    const state = await this.ctx.storage.get<ConnectorState>("state");
    if (!state || !state.paired) {
      if (url.pathname === "/status")
        return json({
          enabled: true,
          paired: false,
          deviceName: null,
          lastSeenAt: null,
          state: "unpaired",
          identity: null,
          candidateIdentity: null,
          lastSyncAt: null,
          error: null,
          loginExpiresAt: null,
        });
      return fail("Pair your Raspberry Pi first.", 410);
    }
    if (
      ["/poll", "/result", "/device-socket"].includes(url.pathname) &&
      request.headers.get("X-Connector-Key") !== state.deviceKey
    ) {
      return fail("This connector has been replaced.", 410);
    }
    await this.expire(state);
    if (url.pathname === "/status") {
      await this.save(state);
      return json({
        enabled: true,
        paired: true,
        deviceName: state.deviceName,
        lastSeenAt: state.lastSeenAt,
        state:
          !this.ctx.getWebSockets("device").length &&
          (!state.lastSeenAt ||
            Date.parse(state.lastSeenAt) < Date.now() - 90_000)
            ? "offline"
            : state.phase,
        identity: state.identity,
        candidateIdentity: state.candidateIdentity,
        lastSyncAt: state.lastSyncAt,
        error: state.error,
        loginExpiresAt: state.loginSession?.expiresAt ?? null,
      });
    }
    if (url.pathname === "/disconnect") {
      await this.closeView(state);
      state.paired = false;
      state.command = null;
      state.candidateIdentity = null;
      await this.env.DB.batch([
        this.env.DB.prepare(
          "UPDATE canvas_connector_device SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL",
        ).bind(new Date().toISOString(), state.workspaceId),
        this.env.DB.prepare(
          "UPDATE integration_connection SET status = 'disconnected', encrypted_credential = NULL, reconnect_needed = 0 WHERE workspace_id = ? AND provider = 'canvas' AND json_extract(metadata_json, '$.transport') = 'browser'",
        ).bind(state.workspaceId),
      ]);
      await this.save(state);
      return json({ ok: true });
    }
    if (url.pathname === "/poll") {
      state.lastSeenAt = new Date().toISOString();
      if (
        state.identity &&
        !state.loginSession &&
        !state.command &&
        state.phase !== "login_required" &&
        state.nextSyncAt <= Date.now()
      ) {
        this.command(state, "sync");
        state.phase = "syncing";
      }
      await this.save(state);
      return json({ command: state.command, loginSession: state.loginSession });
    }
    if (url.pathname === "/login") {
      if (state.command?.kind === "sync")
        return fail("Wait for the current sync to finish.");
      if (
        !state.lastSeenAt ||
        Date.parse(state.lastSeenAt) < Date.now() - 90_000
      )
        return fail("Your Raspberry Pi is offline. Start the connector first.");
      await this.closeView(state);
      state.loginSession = {
        id: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      state.phase = "signing_in";
      state.candidateIdentity = null;
      state.error = null;
      this.command(state, "login");
      await this.save(state);
      await this.ctx.storage.setAlarm(Date.parse(state.loginSession.expiresAt));
      return json({ ok: true });
    }
    if (url.pathname === "/close") {
      if (!state.loginSession) return json({ ok: true });
      await this.closeView(state);
      state.command = null;
      state.candidateIdentity = null;
      state.phase = state.identity ? "connected" : "ready";
      await this.save(state);
      return json({ ok: true });
    }
    if (url.pathname === "/verify") {
      if (!state.loginSession || state.command)
        return fail("Wait for the sign-in browser to be ready.");
      this.command(state, "verify");
      state.error = null;
      await this.save(state);
      return json({ ok: true });
    }
    if (url.pathname === "/confirm") {
      const input = z
        .object({ userId: z.string() })
        .strict()
        .parse(await request.json());
      if (
        !state.loginSession ||
        state.phase !== "awaiting_confirmation" ||
        !state.candidateIdentity ||
        state.candidateIdentity.id !== input.userId
      )
        return fail("Verify your Canvas account before confirming.");
      const identity = state.candidateIdentity;
      if (state.identity && state.identity.id !== identity.id)
        return fail(
          "This is a different Canvas account. Disconnect first to change accounts.",
        );
      const now = new Date().toISOString();
      const metadata = {
        ...createCanvasConnectionMetadata({
          baseUrl: new URL(state.baseUrl),
          userId: identity.id,
          userName: identity.name,
          now,
        }),
        transport: "browser",
      };
      await this.env.DB.prepare(
        `INSERT INTO integration_connection
        (workspace_id, provider, account_label, status, scopes_json, encrypted_credential, credential_key_version, last_attempt_at, reconnect_needed, metadata_json, updated_at)
        VALUES (?, 'canvas', ?, 'delayed', '["read-only"]', NULL, 1, ?, 0, ?, ?)
        ON CONFLICT(workspace_id, provider) DO UPDATE SET account_label=excluded.account_label, status=excluded.status,
        encrypted_credential=NULL, last_error_category=NULL, reconnect_needed=0, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`,
      )
        .bind(
          state.workspaceId,
          `${identity.name} · ${identity.hostname}`,
          now,
          JSON.stringify(metadata),
          now,
        )
        .run();
      state.identity = identity;
      state.candidateIdentity = null;
      state.phase = "syncing";
      await this.closeView(state);
      this.command(state, "sync");
      await this.save(state);
      return json({ ok: true });
    }
    if (url.pathname === "/sync") {
      if (!state.identity || state.phase === "login_required")
        return fail("Sign in to Canvas first.");
      if (state.loginSession)
        return fail("Finish or close Canvas sign-in first.");
      if (!state.command) this.command(state, "sync");
      state.phase = "syncing";
      state.error = null;
      await this.save(state);
      return json({ ok: true });
    }
    if (url.pathname === "/view") {
      if (!state.loginSession || !this.ctx.getWebSockets("device").length) {
        this.diagnostic(state, "device_not_connected");
        return fail(
          "The Pi is opening the browser. Try viewing again in a few seconds.",
        );
      }
      if (this.ctx.getWebSockets("viewer").length)
        return fail("Canvas sign-in is already open in another window.");
      const token = randomToken();
      const expiresAt = Math.min(
        Date.now() + 60_000,
        Date.parse(state.loginSession.expiresAt),
      );
      await this.ctx.storage.put("ticket", {
        hash: await sha256(token),
        sessionId: state.loginSession.id,
        expiresAt,
      });
      const target = new URL(
        "/api/canvas-view",
        this.env.CONNECTOR_PUBLIC_ORIGIN ?? this.env.APP_ORIGIN,
      );
      target.protocol = target.protocol === "http:" ? "ws:" : "wss:";
      target.searchParams.set("workspace", state.workspaceId);
      target.searchParams.set("ticket", token);
      return json({
        url: target.href,
        expiresAt: state.loginSession.expiresAt,
      });
    }
    if (
      url.pathname === "/device-socket" ||
      url.pathname === "/viewer-socket"
    ) {
      if (
        !state.loginSession ||
        request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
      )
        return fail("Sign-in has ended.");
      const role = url.pathname === "/device-socket" ? "device" : "viewer";
      if (
        role === "device" &&
        url.searchParams.get("sessionId") !== state.loginSession.id
      )
        return fail("Sign-in session changed.");
      if (role === "viewer") {
        const ticket = ticketSchema.safeParse(
          await this.ctx.storage.get("ticket"),
        );
        if (
          !ticket.success ||
          ticket.data.expiresAt <= Date.now() ||
          ticket.data.sessionId !== state.loginSession.id ||
          ticket.data.hash !==
            (await sha256(url.searchParams.get("ticket") ?? ""))
        )
          return fail("Sign-in link expired. Open it again.", 401);
        await this.ctx.storage.delete("ticket");
        if (!this.ctx.getWebSockets("device").length)
          return fail("The Pi disconnected. Try again.");
      }
      if (this.ctx.getWebSockets(role).length)
        return fail("A connection is already active.");
      this.diagnostic(state, `${role}_socket_connected`);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [role]);
      pair[1].serializeAttachment({
        role,
        sessionId: state.loginSession.id,
        expiresAt: Date.parse(state.loginSession.expiresAt),
      });
      if (role === "viewer")
        for (const ws of this.ctx.getWebSockets("device"))
          ws.send(JSON.stringify({ type: "viewer_connected" }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === "/result") {
      const result = connectorResultSchema.parse(await request.json());
      if (state.completed.includes(result.commandId)) return json({ ok: true });
      state.lastSeenAt = new Date().toISOString();
      const command = state.command;
      if (!command || command.id !== result.commandId)
        return fail("This command is no longer active.");
      if (
        (result.status === "login_ready" && command.kind !== "login") ||
        (result.status === "identity" && command.kind !== "verify") ||
        (result.status === "sync" && command.kind !== "sync")
      )
        return fail("Unexpected command result.");
      this.diagnostic(state, "command_result", {
        command: command.kind,
        status: result.status,
        ...(result.status === "error"
          ? {
              error: result.error,
              ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
            }
          : {}),
      });
      if (result.status === "error") {
        state.error =
          result.error === "login_required"
            ? "Canvas needs you to sign in again."
            : "Canvas could not be read. Try again shortly.";
        if (result.diagnostic) {
          const messages = {
            profile_in_use:
              "The Pi browser profile is already in use. Restart the connector service.",
            display_unavailable:
              "Chromium cannot open the Pi display. Check the Xvfb service.",
            browser_control_blocked:
              "Chromium policy blocked the connector's browser control connection.",
            browser_launch_timeout:
              "Chromium did not respond to the connector before startup timed out.",
            browser_launch_failed:
              "Chromium could not start on the Pi. Check the connector service journal.",
          };
          state.error = messages[result.diagnostic];
        }
        state.phase =
          result.error === "login_required" ? "login_required" : "error";
        state.nextSyncAt = Date.now() + 5 * 60_000;
        if (state.identity)
          await this.env.DB.prepare(
            "UPDATE integration_connection SET status = ?, reconnect_needed = ?, last_error_category = ? WHERE workspace_id = ? AND provider = 'canvas'",
          )
            .bind(
              result.error === "login_required" ? "action_needed" : "delayed",
              result.error === "login_required" ? 1 : 0,
              result.error,
              state.workspaceId,
            )
            .run();
      } else if (result.status === "identity" || result.status === "sync") {
        if (
          result.identity.hostname !== new URL(state.baseUrl).hostname ||
          (state.identity && result.identity.id !== state.identity.id)
        ) {
          state.phase = "login_required";
          state.error =
            "The browser is signed in to a different Canvas account. Reconnect with the original account.";
        } else if (result.status === "identity") {
          state.candidateIdentity = result.identity;
          state.phase = "awaiting_confirmation";
          state.error = null;
        } else {
          if (!state.identity)
            return fail("Confirm the Canvas identity before importing.");
          if (
            result.data.assignments.some(
              (a) => new URL(a.htmlUrl).origin !== state.baseUrl,
            )
          )
            return fail(
              "Canvas returned an unexpected assignment address.",
              400,
            );
          const outcome = await runCanvasSync(
            this.env,
            state.workspaceId,
            "manual",
            { result: result.data, deliveryId: result.commandId },
          );
          if (outcome.result === "skipped") {
            const finished = await this.env.DB.prepare(
              "SELECT result FROM sync_run WHERE id = ? AND workspace_id = ?",
            )
              .bind(outcome.runId, state.workspaceId)
              .first<{ result: string }>();
            if (!finished || !["success", "partial"].includes(finished.result))
              return fail(
                "A sync is still active. Retry this result shortly.",
                503,
              );
          }
          state.phase = "connected";
          state.lastSyncAt = new Date().toISOString();
          state.error = result.data.partialFailures.length
            ? "Some courses could not be read. Your existing assignments were retained."
            : null;
          state.nextSyncAt = Date.now() + 60 * 60_000;
          this.ctx.waitUntil(
            Promise.all([
              runCalendarReconciliation(this.env, state.workspaceId),
              sendUrgentImport(
                this.env,
                state.workspaceId,
                outcome.runId,
                outcome.createdIds,
              ),
            ]).catch(() => undefined),
          );
        }
      }
      state.completed = [...state.completed.slice(-31), result.commandId];
      state.command = null;
      await this.save(state);
      return json({ ok: true });
    }
    return fail("Unknown connector operation.", 404);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = attachmentSchema.safeParse(ws.deserializeAttachment());
    const state = await this.ctx.storage.get<ConnectorState>("state");
    if (
      !attachment.success ||
      !state?.loginSession ||
      state.loginSession.id !== attachment.data.sessionId ||
      attachment.data.expiresAt <= Date.now() ||
      typeof message === "string" ||
      message.byteLength > 2_000_000
    ) {
      ws.close(1008, "Invalid or expired sign-in stream");
      return;
    }
    if (!attachment.data.receivedData) {
      ws.serializeAttachment({ ...attachment.data, receivedData: true });
      this.diagnostic(state, `${attachment.data.role}_first_data`, {
        bytes: message.byteLength,
      });
    }
    const peerRole = attachment.data.role === "viewer" ? "device" : "viewer";
    for (const peer of this.ctx.getWebSockets(peerRole)) {
      const peerInfo = attachmentSchema.safeParse(peer.deserializeAttachment());
      if (
        peerInfo.success &&
        peerInfo.data.sessionId === attachment.data.sessionId
      )
        peer.send(message);
    }
  }

  async webSocketClose(ws: WebSocket, code = 1006) {
    const info = attachmentSchema.safeParse(ws.deserializeAttachment());
    if (!info.success) return;
    const state = await this.ctx.storage.get<ConnectorState>("state");
    if (state)
      this.diagnostic(state, `${info.data.role}_socket_closed`, { code });
    const peerRole = info.data.role === "viewer" ? "device" : "viewer";
    for (const peer of this.ctx.getWebSockets(peerRole)) {
      const peerInfo = attachmentSchema.safeParse(peer.deserializeAttachment());
      if (!peerInfo.success || peerInfo.data.sessionId !== info.data.sessionId)
        continue;
      if (info.data.role === "viewer")
        peer.send(JSON.stringify({ type: "viewer_disconnected" }));
      else peer.close(1011, "Pi disconnected");
    }
  }
  async webSocketError(ws: WebSocket) {
    ws.close(1011, "Sign-in connection failed");
    await this.webSocketClose(ws);
  }
  async alarm() {
    await this.serialize(async () => {
      const state = await this.ctx.storage.get<ConnectorState>("state");
      if (state) {
        await this.expire(state);
        await this.save(state);
      }
    });
  }
}
