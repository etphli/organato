import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const directory = await mkdtemp(join(tmpdir(), "organato-connector-test-"));
const hash = (value) => createHash("sha256").update(value).digest("base64url");
let mf;
try {
  await build({
    stdin: {
      contents: `import worker from ${JSON.stringify(resolve("apps/worker/src/index.ts"))};
        import { runCanvasSync } from ${JSON.stringify(resolve("apps/worker/src/sync.ts"))};
        export * from ${JSON.stringify(resolve("apps/worker/src/index.ts"))};
        export default { ...worker, async fetch(request, env, ctx) {
          if (new URL(request.url).pathname !== "/__test/import") return worker.fetch(request, env, ctx);
          const input = await request.json();
          let queries = 0, importing = false;
          const testDB = {
            prepare(sql) { queries++; if (sql.startsWith("INSERT INTO subject")) importing = true; return env.DB.prepare(sql); },
            async batch(statements) {
              if (importing && input.fault) {
                importing = false;
                if (input.fault === "disconnect") await env.DB.prepare("UPDATE integration_connection SET status='disconnected' WHERE workspace_id='alice' AND provider='canvas'").run();
                else await env.DB.prepare("UPDATE integration_connection SET metadata_json=json_set(metadata_json, '$.userId', 'replacement') WHERE workspace_id='alice' AND provider='canvas'").run();
              }
              return env.DB.batch(statements);
            }
          };
          try {
            const outcome = await runCanvasSync({ ...env, DB: testDB }, "alice", "manual", { result: input.data, deliveryId: crypto.randomUUID() });
            return Response.json({ outcome, queries });
          } catch (error) { return Response.json({ error: error.message, queries }); }
        }};`,
      resolveDir: process.cwd(),
      loader: "js",
    },
    outfile: join(directory, "worker.mjs"),
    bundle: true,
    format: "esm",
    platform: "browser",
    external: ["cloudflare:workers"],
  });
  mf = new Miniflare({
    modulesRoot: directory,
    modules: true,
    scriptPath: join(directory, "worker.mjs"),
    compatibilityDate: "2026-07-25",
    durableObjects: {
      CANVAS_CONNECTOR: { className: "CanvasConnector", useSQLite: true },
    },
    d1Databases: { DB: "connector-test" },
    bindings: {
      APP_ORIGIN: "https://organato.test",
      CONNECTOR_PUBLIC_ORIGIN: "https://worker.test",
      CANVAS_BASE_URL: "https://canvas.test",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url"),
      DEMO_MODE: "false",
    },
  });
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(join("migrations", file), "utf8")).replace(
      /^--.*$/gm,
      "",
    );
    let statement = "";
    for (const part of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      statement += part + ";";
      if (/^CREATE TRIGGER/i.test(statement) && !/END;$/i.test(statement))
        continue;
      await db.prepare(statement).run();
      statement = "";
    }
  }
  const now = new Date().toISOString(),
    expiry = new Date(Date.now() + 86400000).toISOString();
  for (const user of ["alice", "bob"]) {
    await db
      .prepare(
        "INSERT INTO workspace (id, name, created_at, updated_at) VALUES (?, 'Test', ?, ?)",
      )
      .bind(user, now, now)
      .run();
    await db
      .prepare(
        "INSERT INTO allowed_identity (email_normalized, workspace_id, display_name, enabled, created_at) VALUES (?, ?, ?, 1, ?)",
      )
      .bind(`${user}@test.invalid`, user, user, now)
      .run();
    await db
      .prepare(
        "INSERT INTO session (id_hash, email_normalized, csrf_hash, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        hash(user),
        `${user}@test.invalid`,
        hash("csrf"),
        now,
        now,
        expiry,
        expiry,
      )
      .run();
  }
  const userRequest = (path, user = "alice", body) =>
    mf.dispatchFetch(
      `https://worker.test/api/integrations/canvas/connector${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: `organato_session=${user}`,
          Origin: "https://organato.test",
          "X-CSRF-Token": "csrf",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
  const deviceRequest = (path, token, body = {}) =>
    mf.dispatchFetch(`https://worker.test/api/canvas-device${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  async function ok(responsePromise) {
    const response = await responsePromise;
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }
  assert.equal((await ok(userRequest(""))).state, "unpaired");
  assert.equal(
    (
      await mf.dispatchFetch(
        "https://worker.test/api/integrations/canvas/connector",
      )
    ).status,
    401,
  );
  const pair = await ok(userRequest("/pair", "alice", {}));
  const paired = await ok(
    deviceRequest("/pair", "", { code: pair.code, name: "Test Pi" }),
  );
  assert.equal(
    (await deviceRequest("/pair", "", { code: pair.code, name: "Replay" }))
      .status,
    401,
  );
  assert.equal((await ok(userRequest("", "bob"))).paired, false);
  assert.equal((await ok(userRequest(""))).paired, true);
  assert.equal(
    (await userRequest("/confirm", "alice", { userId: "42" })).status,
    409,
  );
  await ok(userRequest("/login", "alice", {}));
  let poll = await ok(deviceRequest("/poll", paired.token));
  assert.equal(poll.command.kind, "login");
  const loginSession = poll.loginSession.id;
  await ok(
    deviceRequest("/result", paired.token, {
      commandId: poll.command.id,
      status: "login_ready",
    }),
  );
  const deviceSocketResponse = await mf.dispatchFetch(
    `https://worker.test/api/canvas-device/socket?sessionId=${loginSession}`,
    {
      headers: {
        Authorization: `Bearer ${paired.token}`,
        Upgrade: "websocket",
      },
    },
  );
  assert.equal(deviceSocketResponse.status, 101);
  const deviceSocket = deviceSocketResponse.webSocket;
  deviceSocket.accept();
  const view = await ok(userRequest("/view", "alice", {}));
  assert.equal(
    view.expiresAt,
    poll.loginSession.expiresAt,
    "Viewer lifetime must use the login session expiry, not the one-minute ticket expiry",
  );
  assert.equal(
    (
      await mf.dispatchFetch(view.url.replace("wss:", "https:"), {
        headers: { Origin: "https://evil.test", Upgrade: "websocket" },
      })
    ).status,
    403,
  );
  const viewerResponse = await mf.dispatchFetch(
    view.url.replace("wss:", "https:"),
    { headers: { Origin: "https://organato.test", Upgrade: "websocket" } },
  );
  assert.equal(viewerResponse.status, 101);
  const viewer = viewerResponse.webSocket;
  viewer.accept();
  assert.equal(
    (
      await mf.dispatchFetch(view.url.replace("wss:", "https:"), {
        headers: { Origin: "https://organato.test", Upgrade: "websocket" },
      })
    ).status,
    401,
  );
  const forwarded = new Promise((resolve) =>
    deviceSocket.addEventListener("message", (e) => {
      if (typeof e.data !== "string") resolve(e.data);
    }),
  );
  viewer.send(new Uint8Array([1, 2, 3]).buffer);
  assert.deepEqual(new Uint8Array(await forwarded), new Uint8Array([1, 2, 3]));
  await ok(userRequest("/verify", "alice", {}));
  poll = await ok(deviceRequest("/poll", paired.token));
  const identity = { id: "42", name: "Alice Canvas", hostname: "canvas.test" };
  await ok(
    deviceRequest("/result", paired.token, {
      commandId: poll.command.id,
      status: "identity",
      identity,
    }),
  );
  assert.equal((await ok(userRequest(""))).state, "awaiting_confirmation");
  assert.equal(
    (await userRequest("/confirm", "alice", { userId: "wrong" })).status,
    409,
  );
  await ok(userRequest("/confirm", "alice", { userId: "42" }));
  poll = await ok(deviceRequest("/poll", paired.token));
  assert.equal(poll.command.kind, "sync");
  const data = {
    courses: [{ id: "7", name: "English", workflowState: "available" }],
    assignments: [
      {
        id: "12",
        courseId: "7",
        name: "Read Macbeth",
        dueAt: expiry,
        htmlUrl: "https://canvas.test/courses/7/assignments/12",
        updatedAt: now,
        published: true,
        submitted: false,
      },
    ],
    partialFailures: [],
    successfulCourseIds: ["7"],
    catalogueComplete: true,
    skippedMalformedItems: 0,
  };
  const result = { commandId: poll.command.id, status: "sync", identity, data };
  const queued = await ok(userRequest("/sync", "alice", {}));
  assert.equal(queued.status, "queued");
  assert.equal(queued.commandId, poll.command.id);

  await ok(deviceRequest("/result", paired.token, result));
  const importedStatus = await ok(userRequest(""));
  assert.equal(importedStatus.lastSync.commandId, result.commandId);
  assert.equal(importedStatus.lastSync.created, 1);
  assert.equal(importedStatus.lastSync.fetched, 1);

  await ok(deviceRequest("/result", paired.token, result));
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM item WHERE workspace_id = 'alice'")
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM item WHERE workspace_id = 'bob'")
        .first()
    ).n,
    0,
  );
  assert.equal((await ok(userRequest(""))).state, "connected");
  assert.equal(
    (
      await db
        .prepare(
          "SELECT encrypted_credential FROM integration_connection WHERE workspace_id = 'alice'",
        )
        .first()
    ).encrypted_credential,
    null,
  );
  await db
    .prepare(
      "UPDATE item SET display_name='My own title' WHERE workspace_id='alice'",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO field_override (item_id, field_name, override_value_json, origin, created_at, updated_at, workspace_id) SELECT id, 'name', '\"My own title\"', 'organato', ?, ?, 'alice' FROM item WHERE workspace_id='alice'",
    )
    .bind(now, now)
    .run();
  await ok(userRequest("/sync", "alice", {}));
  poll = await ok(deviceRequest("/poll", paired.token));
  assert.equal(
    (
      await deviceRequest("/result", paired.token, {
        ...result,
        commandId: poll.command.id,
        data: { ...data, successfulCourseIds: ["unknown"] },
      })
    ).status,
    400,
  );
  await ok(
    deviceRequest("/result", paired.token, {
      ...result,
      commandId: poll.command.id,
      data: {
        ...data,
        assignments: [],
        partialFailures: [{ courseId: "7", category: "read_failed" }],
        successfulCourseIds: [],
      },
    }),
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT missing_sync_count FROM item WHERE workspace_id='alice'",
        )
        .first()
    ).missing_sync_count,
    0,
  );
  await ok(userRequest("/sync", "alice", {}));
  poll = await ok(deviceRequest("/poll", paired.token));
  await ok(
    deviceRequest("/result", paired.token, {
      ...result,
      commandId: poll.command.id,
      data: {
        ...data,
        assignments: [
          { ...data.assignments[0], name: "Teacher updated title" },
        ],
      },
    }),
  );
  const overridden = await db
    .prepare(
      "SELECT display_name, source_name FROM item WHERE workspace_id='alice'",
    )
    .first();
  assert.equal(overridden.display_name, "My own title");
  assert.equal(overridden.source_name, "Teacher updated title");
  const generation = await db
    .prepare(
      "SELECT metadata_json FROM integration_connection WHERE workspace_id='alice' AND provider='canvas'",
    )
    .first();
  for (const fault of ["disconnect", "switch"]) {
    const fenced = await ok(
      mf.dispatchFetch("https://worker.test/__test/import", {
        method: "POST",
        body: JSON.stringify({
          fault,
          data: {
            ...data,
            assignments: [
              { ...data.assignments[0], name: "Stale update must not import" },
            ],
          },
        }),
      }),
    );
    assert.match(fenced.error, /connection changed/);
    assert.ok(
      fenced.queries < 25,
      `Import issued ${fenced.queries} database statements`,
    );
    assert.equal(
      (
        await db
          .prepare("SELECT source_name FROM item WHERE workspace_id='alice'")
          .first()
      ).source_name,
      "Teacher updated title",
    );
    if (fault === "disconnect")
      assert.equal(
        (
          await db
            .prepare(
              "SELECT status FROM integration_connection WHERE workspace_id='alice' AND provider='canvas'",
            )
            .first()
        ).status,
        "disconnected",
      );
    await db
      .prepare(
        "UPDATE integration_connection SET metadata_json=?, status='healthy' WHERE workspace_id='alice' AND provider='canvas'",
      )
      .bind(generation.metadata_json)
      .run();
  }
  await ok(userRequest("/sync", "alice", {}));
  poll = await ok(deviceRequest("/poll", paired.token));
  const missingResult = {
    ...result,
    commandId: poll.command.id,
    data: { ...data, assignments: [] },
  };
  await db
    .prepare(
      "CREATE TRIGGER fail_connector_finish BEFORE UPDATE ON integration_connection WHEN NEW.workspace_id='alice' AND NEW.status='healthy' BEGIN SELECT RAISE(ABORT, 'injected test interruption'); END",
    )
    .run();
  assert.equal(
    (await deviceRequest("/result", paired.token, missingResult)).status,
    503,
  );
  await db.prepare("DROP TRIGGER fail_connector_finish").run();
  await ok(deviceRequest("/result", paired.token, missingResult));
  const retained = await db
    .prepare(
      "SELECT missing_sync_count, archived_at FROM item WHERE workspace_id='alice'",
    )
    .first();
  assert.equal(retained.missing_sync_count, 1);
  assert.equal(retained.archived_at, null);
  if (process.env.CONNECTOR_STRESS === "1") {
    await ok(userRequest("/sync", "alice", {}));
    poll = await ok(deviceRequest("/poll", paired.token));
    const assignments = Array.from({ length: 2000 }, (_, index) => ({
      ...data.assignments[0],
      id: String(12 + index),
      htmlUrl: `https://canvas.test/courses/7/assignments/${12 + index}`,
    }));
    const started = performance.now();
    await ok(
      deviceRequest("/result", paired.token, {
        ...result,
        commandId: poll.command.id,
        data: { ...data, assignments },
      }),
    );
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM item WHERE workspace_id='alice'")
          .first()
      ).n,
      2000,
    );
    console.log(
      `Imported the maximum 2000-assignment payload locally in ${Math.round(performance.now() - started)} ms.`,
    );
    const bulk = await ok(
      mf.dispatchFetch("https://worker.test/__test/import", {
        method: "POST",
        body: JSON.stringify({
          data: {
            ...data,
            assignments: assignments.map((a) => ({
              ...a,
              name: "Bulk update",
            })),
          },
        }),
      }),
    );
    assert.equal(bulk.outcome.updated, 2000);
    assert.ok(
      bulk.queries < 25,
      `Maximum import issued ${bulk.queries} statements`,
    );
    console.log(`Maximum update uses ${bulk.queries} database statements.`);
    await db
      .prepare(
        "DELETE FROM item WHERE workspace_id='alice' AND canvas_assignment_id <> '12'",
      )
      .run();
  }
  await ok(userRequest("/sync", "alice", {}));
  poll = await ok(deviceRequest("/poll", paired.token));
  await ok(
    deviceRequest("/result", paired.token, {
      ...result,
      commandId: poll.command.id,
      identity: { ...identity, id: "another-user" },
    }),
  );
  assert.equal((await ok(userRequest(""))).state, "login_required");
  await ok(userRequest("/disconnect", "alice", {}));
  assert.equal((await deviceRequest("/poll", paired.token)).status, 410);
  assert.equal(
    (await deviceRequest("/result", paired.token, result)).status,
    410,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM item WHERE workspace_id='alice'")
        .first()
    ).n,
    1,
  );
  assert.equal((await ok(userRequest(""))).paired, false);
  assert.equal((await ok(userRequest(""))).erasurePending, true);
  await ok(deviceRequest("/erased", paired.token));
  assert.equal((await ok(userRequest(""))).erasurePending, false);
  const replacementCode = await ok(userRequest("/pair", "alice", {}));
  const replacement = await ok(
    deviceRequest("/pair", "", {
      code: replacementCode.code,
      name: "Replacement Pi",
    }),
  );
  const namespace = await mf.getDurableObjectNamespace("CANVAS_CONNECTOR");
  const stale = await namespace
    .get(namespace.idFromName("alice"))
    .fetch("https://connector/poll", {
      method: "POST",
      headers: { "X-Connector-Key": hash(paired.token) },
    });
  assert.equal(stale.status, 410);
  assert.equal(
    (await ok(deviceRequest("/poll", replacement.token))).command,
    null,
  );
  await ok(userRequest("/login", "alice", {}));
  const logoutPoll = await ok(deviceRequest("/poll", replacement.token));
  await ok(
    deviceRequest("/result", replacement.token, {
      commandId: logoutPoll.command.id,
      status: "login_ready",
    }),
  );
  const logoutDeviceResponse = await mf.dispatchFetch(
    `https://worker.test/api/canvas-device/socket?sessionId=${logoutPoll.loginSession.id}`,
    {
      headers: {
        Authorization: `Bearer ${replacement.token}`,
        Upgrade: "websocket",
      },
    },
  );
  assert.equal(logoutDeviceResponse.status, 101);
  logoutDeviceResponse.webSocket.accept();
  const logoutView = await ok(userRequest("/view", "alice", {}));
  const logoutSocketResponse = await mf.dispatchFetch(
    logoutView.url.replace("wss:", "https:"),
    { headers: { Origin: "https://organato.test", Upgrade: "websocket" } },
  );
  assert.equal(logoutSocketResponse.status, 101);
  logoutSocketResponse.webSocket.accept();
  await ok(
    mf.dispatchFetch("https://worker.test/api/auth/logout", {
      method: "POST",
      headers: {
        Cookie: "organato_session=alice",
        Origin: "https://organato.test",
        "X-CSRF-Token": "csrf",
        "Content-Type": "application/json",
      },
      body: "{}",
    }),
  );
  const loggedOut = await namespace
    .get(namespace.idFromName("alice"))
    .fetch("https://connector/status")
    .then((r) => r.json());
  assert.equal(loggedOut.loginExpiresAt, null);
  let forwardedAfterLogout = false;
  logoutDeviceResponse.webSocket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") forwardedAfterLogout = true;
  });
  logoutSocketResponse.webSocket.send(new Uint8Array([8, 9]).buffer);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    forwardedAfterLogout,
    false,
    "Logout must end remote browser input",
  );
  logoutSocketResponse.webSocket.close();
  logoutDeviceResponse.webSocket.close();
  assert.equal((await userRequest("")).status, 401);
  console.log(
    "PASS: real Worker + D1 + Durable Object pairing, CSRF session access, one-use view ticket, RFB binary relay, identity confirmation, import, repeated delivery, tenant isolation, partial sync, override preservation, injected import failure/retry, identity change, and revoke.",
  );
} finally {
  await mf?.dispose();
  await rm(directory, { recursive: true, force: true });
}
