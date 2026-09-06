/* global URL, Buffer, setTimeout, clearTimeout */

import net from "node:net";

import { isExpired, ProtocolError, validateApiBase } from "./protocol.mjs";

const MAX_SOCKET_JSON_BYTES = 16 * 1024;

function socketOpen(socket) {
  return socket && socket.readyState === 1;
}

async function defaultWebSocketClass() {
  const module = await import("ws");
  return module.WebSocket ?? module.default;
}

function defaultTcpConnector(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", onError);
    socket.once("connect", () => {
      socket.off("error", onError);
      resolve(socket);
    });
  });
}

export class VncRelay {
  constructor({
    apiBase,
    token,
    vncHost = "127.0.0.1",
    vncPort = 5900,
    logger = () => undefined,
    webSocketClass,
    tcpConnector = defaultTcpConnector,
    reconnectDelayMs = 2_000,
  }) {
    this.apiBase = validateApiBase(apiBase);
    if (typeof token !== "string" || !token.trim())
      throw new ProtocolError("A device token is required.");
    if (vncHost !== "127.0.0.1") {
      throw new ProtocolError(
        "The VNC relay must use the local loopback address.",
      );
    }
    if (!Number.isInteger(vncPort) || vncPort < 1 || vncPort > 65_535) {
      throw new ProtocolError("The VNC relay port is invalid.");
    }
    this.token = token;
    this.vncHost = vncHost;
    this.vncPort = vncPort;
    this.logger = logger;
    this.webSocketClass = webSocketClass;
    this.tcpConnector = tcpConnector;
    this.reconnectDelayMs = reconnectDelayMs;
    this.session = null;
    this.ws = null;
    this.tcp = null;
    this.connectingTcp = null;
    this.timer = null;
    this.reconnectTimer = null;
    this.generation = 0;
    this.stopped = false;
  }

  sessionIsLive(session = this.session) {
    return Boolean(session && !isExpired(session.expiresAt));
  }

  async update(loginSession) {
    if (
      loginSession &&
      (!this.session ||
        this.session.id !== loginSession.id ||
        this.session.expiresAt !== loginSession.expiresAt)
    ) {
      await this.closeConnection();
      this.session = loginSession;
      this.generation += 1;
      this.scheduleExpiry(loginSession, this.generation);
      void this.connectWebSocket(this.generation);
      return;
    }
    if (!loginSession) {
      await this.closeConnection();
      this.session = null;
      this.generation += 1;
      this.clearTimers();
      return;
    }
    if (!this.sessionIsLive()) {
      await this.closeConnection();
      this.session = null;
      this.generation += 1;
    }
  }

  scheduleExpiry(session, generation) {
    this.clearExpiryTimer();
    const delay = Math.max(0, Date.parse(session.expiresAt) - Date.now());
    this.timer = setTimeout(
      () => {
        if (this.generation !== generation) return;
        void this.update(null);
      },
      Math.min(delay, 2_147_000_000),
    );
    this.timer.unref?.();
  }

  clearExpiryTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  clearTimers() {
    this.clearExpiryTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async connectWebSocket(generation) {
    if (this.stopped || generation !== this.generation || !this.sessionIsLive())
      return;
    if (this.ws) return;
    let WebSocketClass = this.webSocketClass;
    try {
      if (!WebSocketClass) WebSocketClass = await defaultWebSocketClass();
      if (generation !== this.generation || !this.sessionIsLive()) return;
      const url = new URL("/api/canvas-device/socket", this.apiBase);
      url.protocol = "wss:";
      url.searchParams.set("sessionId", this.session.id);
      const ws = new WebSocketClass(url.href, {
        headers: { Authorization: `Bearer ${this.token}` },
        perMessageDeflate: false,
        maxPayload: 2_000_000,
      });
      this.ws = ws;
      ws.binaryType = "nodebuffer";
      ws.on("open", () => {
        this.logger("viewer_socket_connected");
      });
      ws.on("message", (data, isBinary) => {
        void this.handleMessage(data, isBinary, generation);
      });
      ws.on("close", () => {
        if (this.ws === ws) this.ws = null;
        void this.closeTcp();
        this.scheduleReconnect(generation);
      });
      ws.on("error", () => {
        this.logger("viewer_socket_error");
      });
    } catch {
      this.scheduleReconnect(generation);
    }
  }

  scheduleReconnect(generation) {
    if (
      this.stopped ||
      generation !== this.generation ||
      !this.sessionIsLive() ||
      this.reconnectTimer
    )
      return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectWebSocket(generation);
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  async handleMessage(data, isBinary, generation) {
    if (generation !== this.generation || !this.sessionIsLive()) return;
    if (isBinary) {
      if (!this.tcp) return;
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (chunk.length > 2_000_000) return;
      this.tcp.write(chunk);
      return;
    }
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    if (text.length > MAX_SOCKET_JSON_BYTES) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message?.type === "viewer_connected") {
      await this.connectTcp(generation);
    } else if (message?.type === "viewer_disconnected") {
      await this.closeTcp();
    }
  }

  async connectTcp(generation) {
    if (generation !== this.generation || !this.sessionIsLive() || this.tcp)
      return;
    if (this.connectingTcp) return this.connectingTcp;
    this.connectingTcp = (async () => {
      try {
        const tcp = await this.tcpConnector(this.vncHost, this.vncPort);
        if (
          generation !== this.generation ||
          !this.sessionIsLive() ||
          !socketOpen(this.ws)
        ) {
          tcp.destroy?.();
          return;
        }
        this.tcp = tcp;
        tcp.on("data", (chunk) => {
          if (
            generation !== this.generation ||
            !this.sessionIsLive() ||
            !socketOpen(this.ws)
          )
            return;
          const buffer = Buffer.from(chunk);
          if (buffer.length <= 2_000_000)
            this.ws.send(buffer, { binary: true });
        });
        tcp.on("close", () => {
          if (this.tcp === tcp) this.tcp = null;
        });
        tcp.on("error", () => {
          if (this.tcp === tcp) this.tcp = null;
        });
        this.logger("vnc_connected");
      } catch {
        this.logger("vnc_unavailable");
      } finally {
        this.connectingTcp = null;
      }
    })();
    return this.connectingTcp;
  }

  async closeTcp() {
    const tcp = this.tcp;
    this.tcp = null;
    if (tcp) {
      tcp.destroy?.();
      tcp.end?.();
    }
    if (this.connectingTcp) await this.connectingTcp.catch(() => undefined);
  }

  async closeConnection() {
    this.clearTimers();
    await this.closeTcp();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close?.();
        ws.terminate?.();
      } catch {
        // The socket is already being torn down.
      }
    }
  }

  async stop() {
    this.stopped = true;
    this.generation += 1;
    await this.closeConnection();
    this.session = null;
  }
}
