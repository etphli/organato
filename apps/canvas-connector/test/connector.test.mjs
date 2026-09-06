/* global Response, Buffer */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CanvasBrowserAdapter,
  CanvasBrowserError,
  MAX_CANVAS_RESULT_BYTES,
  normalizeCanvasIdentity,
  normalizeCanvasSyncResult,
  syncInPage,
} from "../src/canvas-browser.mjs";
import { DeviceClient, RESULT_UPLOAD_TIMEOUT_MS } from "../src/client.mjs";
import {
  DEFAULT_SSO_ALLOWLIST,
  DeviceApiError,
  DeviceRevokedError,
  DestinationPolicy,
  ProtocolError,
  isApiWriteRequest,
  isPrivateAddress,
  parseJsonText,
  parseSsoAllowlist,
} from "../src/protocol.mjs";
import { ConnectorService } from "../src/service.mjs";
import { VncRelay } from "../src/relay.mjs";
import { DurableState } from "../src/state.mjs";

const API_BASE = "https://api.example.org";
const CANVAS_BASE = "https://canvas.example.org";
const TOKEN = "a".repeat(64);
const ISO_NOW = "2026-09-06T00:00:00.000Z";

async function withTempDirectory(callback) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "organato-canvas-connector-"),
  );
  try {
    return await callback(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

class FakeWebSocket {
  static instances = [];

  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.readyState = 0;
    this.handlers = new Map();
    this.sent = [];
    this.closed = false;
    FakeWebSocket.instances.push(this);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  emit(event, ...args) {
    this.handlers.get(event)?.(...args);
  }

  send(value, options) {
    this.sent.push({ value: Buffer.from(value), options });
  }

  close() {
    this.closed = true;
    this.readyState = 3;
  }

  terminate() {
    this.closed = true;
    this.readyState = 3;
  }
}

class FakeTcp {
  constructor() {
    this.handlers = new Map();
    this.writes = [];
    this.destroyed = false;
    this.ended = false;
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  emit(event, ...args) {
    this.handlers.get(event)?.(...args);
  }

  write(value) {
    this.writes.push(Buffer.from(value));
  }

  destroy() {
    this.destroyed = true;
  }

  end() {
    this.ended = true;
  }
}

test("DurableState persists credentials and pending results with private modes", async () => {
  await withTempDirectory(async (directory) => {
    const state = await new DurableState(path.join(directory, "state")).init();
    await state.saveCredential({
      token: TOKEN,
      apiBase: API_BASE,
      canvasBaseUrl: CANVAS_BASE,
      workspaceId: "workspace-1",
      pairedAt: ISO_NOW,
    });
    await state.savePending("command-1", {
      commandId: "command-1",
      status: "error",
      error: "network_error",
    });

    assert.equal((await state.loadCredential()).token, TOKEN);
    assert.deepEqual(await state.loadPending(), {
      commandId: "command-1",
      result: {
        commandId: "command-1",
        status: "error",
        error: "network_error",
      },
    });
    assert.equal((await fs.stat(state.stateDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(state.credentialFile)).mode & 0o777, 0o600);
    assert.equal((await fs.stat(state.pendingFile)).mode & 0o777, 0o600);

    await fs.mkdir(path.join(state.profileDir, "Default"), { recursive: true });
    await fs.writeFile(
      path.join(state.profileDir, "Default", "Cookies"),
      "owned",
    );
    const sibling = path.join(directory, "keep-me.txt");
    await fs.writeFile(sibling, "unrelated");
    await state.clearCredentialAndProfile();

    assert.equal(await state.loadCredential(), null);
    assert.equal(await state.loadPending(), null);
    await assert.rejects(fs.access(state.profileDir), /ENOENT/);
    assert.equal(await fs.readFile(sibling, "utf8"), "unrelated");
  });
});

test("DeviceClient retries a saved result and clears it only after acknowledgement", async () => {
  assert.ok(RESULT_UPLOAD_TIMEOUT_MS >= 120_000);
  await withTempDirectory(async (directory) => {
    const state = await new DurableState(directory).init();
    const requests = [];
    const client = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async (url, init) => {
        requests.push({ url, init });
        return jsonResponse({ ok: true });
      },
    });

    await client.saveResult("command-2", { status: "login_ready" });
    await client.flushPending();
    assert.equal(await state.loadPending(), null);
    assert.equal(requests.length, 1);
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      commandId: "command-2",
      status: "login_ready",
    });
    assert.equal(requests[0].init.headers.Authorization, `Bearer ${TOKEN}`);

    await state.savePending("command-3", {
      commandId: "command-3",
      status: "error",
      error: "network_error",
    });
    const offlineClient = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async () => {
        throw new Error("offline");
      },
    });
    await assert.rejects(offlineClient.flushPending(), (error) => {
      assert.ok(error instanceof DeviceApiError);
      assert.equal(error.code, "network_error");
      return true;
    });
    assert.equal((await state.loadPending()).commandId, "command-3");

    const staleClient = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async () => jsonResponse({ error: "stale" }, 409),
    });
    await staleClient.flushPending();
    assert.equal(await state.loadPending(), null);

    await state.savePending("command-4", {
      commandId: "command-4",
      status: "sync",
      identity: {},
      data: {},
    });
    const rejectedBodies = [];
    const replacementClient = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async (_url, init) => {
        rejectedBodies.push(JSON.parse(init.body));
        return rejectedBodies.length === 1
          ? jsonResponse({ error: "invalid" }, 413)
          : jsonResponse({ ok: true });
      },
    });
    await replacementClient.flushPending();
    assert.equal(await state.loadPending(), null);
    assert.deepEqual(rejectedBodies[1], {
      commandId: "command-4",
      status: "error",
      error: "read_failed",
    });

    await state.savePending("command-5", {
      commandId: "command-5",
      status: "error",
      error: "network_error",
    });
    const alwaysRejectedClient = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async () => jsonResponse({ error: "invalid" }, 400),
    });
    await alwaysRejectedClient.flushPending();
    assert.equal(await state.loadPending(), null);

    await state.savePending("command-6", {
      commandId: "wrong-command-id",
      status: "error",
      error: "read_failed",
    });
    const permanentlyUnavailableClient = new DeviceClient({
      apiBase: API_BASE,
      token: TOKEN,
      state,
      fetcher: async () => jsonResponse({ error: "missing" }, 404),
    });
    await permanentlyUnavailableClient.flushPending();
    assert.equal(await state.loadPending(), null);
  });
});

test("VncRelay authenticates the outbound viewer socket and bridges loopback RFB", async () => {
  FakeWebSocket.instances.length = 0;
  const tcp = new FakeTcp();
  let tcpTarget;
  const relay = new VncRelay({
    apiBase: API_BASE,
    token: TOKEN,
    webSocketClass: FakeWebSocket,
    tcpConnector: async (host, port) => {
      tcpTarget = { host, port };
      return tcp;
    },
    reconnectDelayMs: 60_000,
  });
  const session = {
    id: "viewer-session",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  await relay.update(session);
  const ws = FakeWebSocket.instances[0];
  assert.ok(ws);
  assert.equal(
    ws.url,
    `${API_BASE}/api/canvas-device/socket?sessionId=viewer-session`.replace(
      "https://",
      "wss://",
    ),
  );
  assert.equal(ws.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(ws.options.maxPayload, 2_000_000);

  ws.readyState = 1;
  ws.emit("open");
  await relay.handleMessage(
    JSON.stringify({ type: "viewer_connected" }),
    false,
    relay.generation,
  );
  assert.deepEqual(tcpTarget, { host: "127.0.0.1", port: 5900 });

  tcp.emit("data", Buffer.from("server-bytes"));
  assert.deepEqual(ws.sent[0], {
    value: Buffer.from("server-bytes"),
    options: { binary: true },
  });
  await relay.handleMessage(
    Buffer.from("client-bytes"),
    true,
    relay.generation,
  );
  assert.deepEqual(tcp.writes, [Buffer.from("client-bytes")]);

  await relay.stop();
  assert.equal(ws.closed, true);
  assert.equal(tcp.destroyed, true);
  assert.equal(tcp.ended, true);
});

test("revocation erases owned state before acknowledging with the old token", async () => {
  const events = [];
  const client = {
    token: TOKEN,
    async flushPending() {
      return true;
    },
    async poll() {
      throw new DeviceRevokedError(410);
    },
    async postErased() {
      events.push(["ack", this.token]);
    },
  };
  const state = {
    async clearCredentialAndProfile() {
      events.push(["erase"]);
    },
  };
  const relay = {
    async stop() {
      events.push(["relay-stop"]);
    },
  };
  const browser = {
    async close() {
      events.push(["browser-close"]);
    },
  };
  const service = new ConnectorService({ state, client, relay, browser });

  assert.deepEqual(await service.runOnce(), { kind: "revoked" });
  assert.deepEqual(events, [
    ["relay-stop"],
    ["browser-close"],
    ["erase"],
    ["ack", TOKEN],
  ]);
  assert.equal(client.token, "");
  assert.equal(service.running, false);
  assert.deepEqual(await service.runOnce(), { kind: "revoked" });
});

test("ConnectorService uploads the three backend command result variants", async () => {
  const identity = {
    id: "user-1",
    name: "Canvas user",
    hostname: "canvas.example.org",
  };
  const data = {
    courses: [{ id: "course-1", name: "Math", workflowState: "available" }],
    assignments: [],
    partialFailures: [],
    successfulCourseIds: ["course-1"],
    catalogueComplete: true,
    skippedMalformedItems: 0,
  };
  const uploaded = [];
  const client = {
    async saveResult(commandId, result) {
      uploaded.push({ commandId, result });
    },
    async flushPending() {
      return true;
    },
  };
  const browser = {
    async openLogin() {},
    async readIdentity() {
      return identity;
    },
    async fetchUpcomingAssignments() {
      return data;
    },
  };
  const service = new ConnectorService({
    state: {},
    client,
    browser,
    now: () => Date.parse(ISO_NOW),
  });
  const expiresAt = "2026-09-06T00:05:00.000Z";
  await service.processCommand({
    id: "login-command",
    kind: "login",
    expiresAt,
    canvasBaseUrl: CANVAS_BASE,
  });
  await service.processCommand({
    id: "verify-command",
    kind: "verify",
    expiresAt,
    canvasBaseUrl: CANVAS_BASE,
  });
  await service.processCommand({
    id: "sync-command",
    kind: "sync",
    expiresAt,
    canvasBaseUrl: CANVAS_BASE,
  });
  assert.deepEqual(
    uploaded.map(({ result }) => result.status),
    ["login_ready", "identity", "sync"],
  );
  assert.deepEqual(uploaded[1].result.identity, identity);
  assert.deepEqual(uploaded[2].result.data, data);
});

test("allowlist and destination policy reject private, file, unlisted, and credential-bearing URLs", async () => {
  assert.deepEqual(parseSsoAllowlist(""), [...DEFAULT_SSO_ALLOWLIST]);
  assert.throws(
    () =>
      parseSsoAllowlist(
        Array.from(
          { length: 11 },
          (_, index) => `https://sso-${index}.example.org`,
        ).join(","),
      ),
    ProtocolError,
  );
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("2001:4860:4860::8888"), false);

  const lookups = [];
  const policy = new DestinationPolicy({
    canvasBaseUrl: CANVAS_BASE,
    ssoAllowlist: ["https://login.example.org"],
    lookup: async (hostname) => {
      lookups.push(hostname);
      return hostname === "private.example.org"
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }];
    },
  });
  await policy.assertAllowedOrigins();
  assert.equal(await policy.isAllowed(`${CANVAS_BASE}/api/v1/courses`), true);
  assert.equal(await policy.isAllowed("https://login.example.org/saml"), true);
  assert.equal(await policy.isAllowed("https://unlisted.example.org/"), false);
  assert.equal(await policy.isAllowed("file:///etc/passwd"), false);
  assert.equal(
    await policy.isAllowed("https://user:pass@canvas.example.org/"),
    false,
  );
  assert.equal(await policy.isAllowed("https://private.example.org/"), false);
  assert.ok(lookups.includes("canvas.example.org"));
  assert.ok(lookups.includes("login.example.org"));

  assert.equal(
    isApiWriteRequest({
      method: () => "GET",
      url: () => `${CANVAS_BASE}/api/v1/courses`,
    }),
    false,
  );
  assert.equal(
    isApiWriteRequest({
      method: () => "POST",
      url: () => `${CANVAS_BASE}/api/v1/courses`,
    }),
    true,
  );
  assert.equal(
    isApiWriteRequest({ method: "POST", url: `${CANVAS_BASE}/login` }),
    false,
  );
});

test("syncInPage follows bounded same-origin pagination and emits Worker-compatible data", async () => {
  const originalFetch = globalThis.fetch;
  const coursesUrl = `${CANVAS_BASE}/api/v1/courses?enrollment_state=active&state[]=available&per_page=100`;
  const coursesPageTwo = `${CANVAS_BASE}/api/v1/courses?page=2`;
  const assignmentsUrl = `${CANVAS_BASE}/api/v1/courses/c1/assignments?bucket=upcoming&override_assignment_dates=true&include[]=submission&per_page=100`;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === coursesUrl) {
      return jsonResponse(
        [{ id: "c1", name: "Mathematics", workflow_state: "available" }],
        200,
        { link: `<${coursesPageTwo}>; rel="next"` },
      );
    }
    if (url === coursesPageTwo) {
      return jsonResponse([
        { id: "c2", name: "Science", workflow_state: "available" },
      ]);
    }
    if (url === assignmentsUrl) {
      return jsonResponse([
        {
          id: "a1",
          course_id: "c1",
          name: "Read chapter one",
          due_at: "2026-09-10T09:00:00.000Z",
          html_url: `${CANVAS_BASE}/courses/c1/assignments/a1`,
          updated_at: ISO_NOW,
          published: true,
          submission: { workflow_state: "unsubmitted" },
        },
      ]);
    }
    if (url.startsWith(`${CANVAS_BASE}/api/v1/courses/c2/assignments?`))
      return jsonResponse([]);
    throw new Error(`unexpected URL: ${url}`);
  };

  try {
    const result = await syncInPage(CANVAS_BASE);
    assert.equal(result.ok, true);
    const normalized = normalizeCanvasSyncResult(result.value, CANVAS_BASE);
    assert.deepEqual(normalized.courses, [
      { id: "c1", name: "Mathematics", workflowState: "available" },
      { id: "c2", name: "Science", workflowState: "available" },
    ]);
    assert.deepEqual(normalized.assignments[0], {
      id: "a1",
      courseId: "c1",
      name: "Read chapter one",
      dueAt: "2026-09-10T09:00:00.000Z",
      htmlUrl: `${CANVAS_BASE}/courses/c1/assignments/a1`,
      updatedAt: ISO_NOW,
      published: true,
      submitted: false,
    });
    assert.equal(normalized.catalogueComplete, true);
    assert.equal(normalized.skippedMalformedItems, 0);
    assert.ok(calls.every(({ init }) => init.method === "GET"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("syncInPage rejects a cross-origin pagination link", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    jsonResponse([], 200, {
      link: '<https://evil.example.org/page>; rel="next"',
    });
  try {
    assert.deepEqual(await syncInPage(CANVAS_BASE), {
      ok: false,
      category: "read_failed",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizers enforce the identity, timestamp, URL, and result-size contract", () => {
  const identity = normalizeCanvasIdentity(
    { id: "user-1", name: "n".repeat(400) },
    "canvas.example.org",
  );
  assert.equal(identity.id, "user-1");
  assert.equal(identity.name.length, 300);
  assert.throws(
    () =>
      normalizeCanvasIdentity(
        { id: "u".repeat(101), name: "User" },
        "canvas.example.org",
      ),
    CanvasBrowserError,
  );
  assert.throws(
    () =>
      normalizeCanvasSyncResult(
        {
          courses: [{ id: "c1", name: "Math", workflowState: "available" }],
          assignments: [
            {
              id: "a1",
              courseId: "c1",
              name: "Bad timestamp",
              dueAt: null,
              htmlUrl: `${CANVAS_BASE}/courses/c1/assignments/a1`,
              updatedAt: "tomorrow",
              published: true,
              submitted: false,
            },
          ],
          partialFailures: [],
          successfulCourseIds: ["c1"],
          catalogueComplete: true,
          skippedMalformedItems: 0,
        },
        CANVAS_BASE,
      ),
    CanvasBrowserError,
  );
  const oversized = {
    courses: [
      { id: "c1", name: "x".repeat(1_000), workflowState: "available" },
    ],
    assignments: [],
    partialFailures: [],
    successfulCourseIds: ["c1"],
    catalogueComplete: true,
    skippedMalformedItems: 0,
  };
  oversized.courses[0].name = "x".repeat(MAX_CANVAS_RESULT_BYTES + 100);
  assert.throws(
    () => normalizeCanvasSyncResult(oversized, CANVAS_BASE),
    CanvasBrowserError,
  );
  assert.throws(
    () => parseJsonText("x".repeat(8 * 1024 * 1024 + 1)),
    ProtocolError,
  );
});

test("CanvasBrowserAdapter applies the browser sandbox and request route policy", async () => {
  await withTempDirectory(async (directory) => {
    const executable = path.join(directory, "chromium");
    await fs.writeFile(executable, "browser");
    const fakePage = {
      on() {},
      async goto() {},
      async bringToFront() {},
    };
    let routeHandler;
    const context = {
      async addInitScript() {},
      async route(_pattern, handler) {
        routeHandler = handler;
      },
      pages() {
        return [fakePage];
      },
      on() {},
      async close() {},
    };
    const adapter = new CanvasBrowserAdapter({
      canvasBaseUrl: CANVAS_BASE,
      profileDir: path.join(directory, "profile"),
      executablePath: executable,
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      browserLauncher: async () => context,
    });
    await adapter.ensureContext();

    async function routeResult(method, url) {
      const result = [];
      await routeHandler({
        request: () => ({ method: () => method, url: () => url }),
        async abort(reason) {
          result.push(["abort", reason]);
        },
        async continue() {
          result.push(["continue"]);
        },
      });
      return result;
    }
    assert.deepEqual(await routeResult("GET", `${CANVAS_BASE}/courses`), [
      ["continue"],
    ]);
    assert.deepEqual(
      await routeResult("POST", `${CANVAS_BASE}/api/v1/courses`),
      [["abort", "blockedbyclient"]],
    );
    assert.deepEqual(
      await routeResult("POST", `${CANVAS_BASE}/courses/c1/assignments`),
      [["abort", "blockedbyclient"]],
    );
    assert.deepEqual(
      await routeResult(
        "POST",
        "https://emanuelschool-login.cloudworkengine.net/session",
      ),
      [["continue"]],
    );
    assert.deepEqual(await routeResult("GET", "file:///etc/passwd"), [
      ["abort", "blockedbyclient"],
    ]);
    assert.deepEqual(
      await routeResult("GET", "https://unlisted.example.org/"),
      [["abort", "blockedbyclient"]],
    );
    await adapter.close();
  });
});
