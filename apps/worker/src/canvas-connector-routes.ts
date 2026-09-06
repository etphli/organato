import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { configuredCanvasInstallation } from "./canvas-connection";
import {
  randomToken,
  rateLimit,
  requireRecentSession,
  sha256,
} from "./security";
import type { Env, Variables } from "./types";

type ConnectorVariables = Variables & {
  connectorWorkspace: string;
  connectorKey: string;
};
const pairingSchema = z
  .object({
    code: z.string().min(12).max(100),
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export function connectorStub(env: Env, workspaceId: string) {
  if (!env.CANVAS_CONNECTOR)
    throw new Error("Canvas connector is not deployed.");
  return env.CANVAS_CONNECTOR.get(env.CANVAS_CONNECTOR.idFromName(workspaceId));
}
export async function browserConnectorActive(env: Env, workspaceId: string) {
  if (!env.CANVAS_CONNECTOR) return false;
  const row = await env.DB.prepare(
    "SELECT 1 AS active FROM integration_connection WHERE workspace_id = ? AND provider = 'canvas' AND status <> 'disconnected' AND json_extract(metadata_json, '$.transport') = 'browser'",
  )
    .bind(workspaceId)
    .first<{ active: number }>();
  return Boolean(row);
}

export const canvasDeviceRoutes = new Hono<{
  Bindings: Env;
  Variables: ConnectorVariables;
}>();
canvasDeviceRoutes.use(
  "*",
  bodyLimit({
    maxSize: 3_000_000,
    onError: (c) => c.json({ error: "Connector request is too large." }, 413),
  }),
);
canvasDeviceRoutes.use("*", async (c, next) => {
  if (!c.env.CANVAS_CONNECTOR)
    return c.json({ error: "Canvas connector is not deployed." }, 503);
  if (
    c.req.method === "POST" &&
    !c.req.header("Content-Type")?.startsWith("application/json")
  )
    return c.json({ error: "Expected JSON." }, 415);
  await next();
});
canvasDeviceRoutes.post("/pair", async (c) => {
  const address = c.req.header("CF-Connecting-IP") ?? "local";
  if (!(await rateLimit(c, `connector-pair:${address}`, 10, 10)))
    return c.json({ error: "Too many attempts. Wait ten minutes." }, 429);
  const parsed = pairingSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: "Enter the pairing code shown in Organato." }, 400);
  const codeHash = await sha256(parsed.data.code.trim());
  const row = await c.env.DB.prepare(
    "DELETE FROM canvas_connector_pairing WHERE code_hash = ? AND expires_at > ? RETURNING workspace_id",
  )
    .bind(codeHash, new Date().toISOString())
    .first<{ workspace_id: string }>();
  if (!row)
    return c.json(
      {
        error:
          "Pairing code expired or already used. Create another in Organato.",
      },
      401,
    );
  const existing = await c.env.DB.prepare(
    "SELECT 1 AS active FROM canvas_connector_device WHERE workspace_id = ? AND revoked_at IS NULL",
  )
    .bind(row.workspace_id)
    .first();
  if (existing)
    return c.json(
      { error: "A Pi is already paired. Disconnect it in Organato first." },
      409,
    );
  const token = randomToken(48);
  const installation = configuredCanvasInstallation(c.env);
  const result = await c.env.DB.prepare(
    `INSERT INTO canvas_connector_device (token_hash, workspace_id, device_name, revoked_at, created_at)
    VALUES (?, ?, ?, NULL, ?) ON CONFLICT DO NOTHING`,
  )
    .bind(
      await sha256(token),
      row.workspace_id,
      parsed.data.name,
      new Date().toISOString(),
    )
    .run();
  if (!result.meta.changes)
    return c.json({ error: "Another device paired first." }, 409);
  const bound = await connectorStub(c.env, row.workspace_id).fetch(
    new Request("https://connector/bind", {
      method: "POST",
      body: JSON.stringify({
        workspaceId: row.workspace_id,
        deviceKey: await sha256(token),
        baseUrl: installation.baseUrl.origin,
        deviceName: parsed.data.name,
      }),
    }),
  );
  if (!bound.ok) {
    await c.env.DB.prepare(
      "UPDATE canvas_connector_device SET revoked_at = ? WHERE token_hash = ?",
    )
      .bind(new Date().toISOString(), await sha256(token))
      .run();
    return c.json(
      { error: "Pairing could not finish. Create a new code." },
      503,
    );
  }
  return c.json({
    token,
    workspaceId: row.workspace_id,
    canvasBaseUrl: installation.baseUrl.origin,
  });
});
canvasDeviceRoutes.post("/erased", async (c) => {
  const token = c.req
    .header("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{64})$/)?.[1];
  if (!token)
    return c.json({ error: "Connector authorization required." }, 401);
  const result = await c.env.DB.prepare(
    "UPDATE canvas_connector_device SET erased_at = ? WHERE token_hash = ? AND revoked_at IS NOT NULL",
  )
    .bind(new Date().toISOString(), await sha256(token))
    .run();
  return result.meta.changes
    ? c.json({ ok: true })
    : c.json({ error: "No revoked connector found." }, 410);
});
canvasDeviceRoutes.use("*", async (c, next) => {
  const token = c.req
    .header("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{64})$/)?.[1];
  if (!token)
    return c.json({ error: "Connector authorization required." }, 401);
  const row = await c.env.DB.prepare(
    `SELECT d.workspace_id FROM canvas_connector_device d WHERE d.token_hash = ? AND d.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM allowed_identity i WHERE i.workspace_id = d.workspace_id AND i.enabled = 1)`,
  )
    .bind(await sha256(token))
    .first<{ workspace_id: string }>();
  if (!row)
    return c.json(
      {
        error:
          "This connector has been disconnected. Erase its local browser profile.",
      },
      410,
    );
  c.set("connectorWorkspace", row.workspace_id);
  c.set("connectorKey", await sha256(token));
  await next();
});
canvasDeviceRoutes.post("/poll", (c) =>
  connectorStub(c.env, c.get("connectorWorkspace")).fetch(
    new Request("https://connector/poll", {
      method: "POST",
      headers: { "X-Connector-Key": c.get("connectorKey") },
    }),
  ),
);
canvasDeviceRoutes.post("/result", async (c) =>
  connectorStub(c.env, c.get("connectorWorkspace")).fetch(
    new Request("https://connector/result", {
      method: "POST",
      headers: { "X-Connector-Key": c.get("connectorKey") },
      body: await c.req.text(),
    }),
  ),
);
canvasDeviceRoutes.get("/socket", (c) => {
  const target = new URL("https://connector/device-socket");
  target.searchParams.set("sessionId", c.req.query("sessionId") ?? "");
  return connectorStub(c.env, c.get("connectorWorkspace")).fetch(
    new Request(target, {
      headers: {
        Upgrade: c.req.header("Upgrade") ?? "",
        "X-Connector-Key": c.get("connectorKey"),
      },
    }),
  );
});

export const canvasConnectorRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();
canvasConnectorRoutes.use(
  "*",
  bodyLimit({
    maxSize: 4096,
    onError: (c) => c.json({ error: "Request too large." }, 413),
  }),
);
canvasConnectorRoutes.use("*", async (c, next) => {
  if (!c.env.CANVAS_CONNECTOR) {
    if (c.req.method === "GET")
      return c.json({
        enabled: false,
        paired: false,
        state: "unpaired",
        deviceName: null,
        lastSeenAt: null,
        identity: null,
        candidateIdentity: null,
        lastSyncAt: null,
        error: null,
        loginExpiresAt: null,
      });
    return c.json(
      { error: "The Canvas connector must be deployed first." },
      503,
    );
  }
  if (c.env.DEMO_MODE === "true" && c.req.method !== "GET")
    return c.json({ error: "Pairing is unavailable in demo mode." }, 403);
  await next();
});
canvasConnectorRoutes.get("/", async (c) => {
  const workspaceId = c.get("user").workspaceId;
  const response = await connectorStub(c.env, workspaceId).fetch(
    new Request("https://connector/status"),
  );
  if (!response.ok) return response;
  const status = z.record(z.unknown()).parse(await response.json());
  const device = await c.env.DB.prepare(
    "SELECT 1 AS pending FROM canvas_connector_device WHERE workspace_id = ? AND revoked_at IS NOT NULL AND erased_at IS NULL LIMIT 1",
  )
    .bind(workspaceId)
    .first<{ pending: number }>();
  return c.json({
    ...status,
    erasurePending: Boolean(device?.pending),
  });
});
canvasConnectorRoutes.use("*", async (c, next) => {
  if (c.req.path.endsWith("/sync") || c.req.path.endsWith("/close"))
    return next();
  return requireRecentSession(30)(c, next);
});
canvasConnectorRoutes.post("/pair", async (c) => {
  const workspaceId = c.get("user").workspaceId;
  if (!(await rateLimit(c, `connector-pair-create:${workspaceId}`, 10, 10)))
    return c.json({ error: "Wait before creating another pairing code." }, 429);
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM canvas_connector_device WHERE workspace_id = ? AND revoked_at IS NULL",
  )
    .bind(workspaceId)
    .first();
  if (existing)
    return c.json(
      { error: "Disconnect the existing Pi before pairing another." },
      409,
    );
  const code = randomToken(18);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM canvas_connector_pairing WHERE expires_at <= ? OR workspace_id = ?",
    ).bind(new Date().toISOString(), workspaceId),
    c.env.DB.prepare(
      "INSERT INTO canvas_connector_pairing (code_hash, workspace_id, expires_at) VALUES (?, ?, ?)",
    ).bind(await sha256(code), workspaceId, expiresAt),
  ]);
  return c.json({ code, expiresAt });
});
for (const action of [
  "login",
  "view",
  "verify",
  "confirm",
  "close",
  "sync",
  "disconnect",
]) {
  canvasConnectorRoutes.post(`/${action}`, async (c) => {
    const workspaceId = c.get("user").workspaceId;
    if (!(await rateLimit(c, `connector-actions:${workspaceId}`, 60, 10)))
      return c.json(
        { error: "Too many connector requests. Wait a few minutes." },
        429,
      );
    return connectorStub(c.env, workspaceId).fetch(
      new Request(`https://connector/${action}`, {
        method: "POST",
        body: await c.req.text(),
      }),
    );
  });
}

export async function canvasViewer(request: Request, env: Env) {
  if (
    !env.CANVAS_CONNECTOR ||
    request.headers.get("Origin") !== new URL(env.APP_ORIGIN).origin
  )
    return Response.json(
      { error: "Sign-in origin rejected." },
      { status: 403 },
    );
  const url = new URL(request.url);
  const workspace = url.searchParams.get("workspace");
  const ticket = url.searchParams.get("ticket");
  if (!workspace || workspace.length > 320 || !ticket || ticket.length > 100)
    return Response.json({ error: "Invalid sign-in link." }, { status: 400 });
  if (
    !(await rateLimit(
      { env },
      `connector-view:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
      30,
      10,
    ))
  )
    return Response.json(
      { error: "Too many sign-in attempts." },
      { status: 429 },
    );
  const active = await env.DB.prepare(
    `SELECT 1 FROM canvas_connector_device d
    WHERE d.workspace_id = ? AND d.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM allowed_identity a WHERE a.workspace_id = d.workspace_id AND a.enabled = 1)`,
  )
    .bind(workspace)
    .first();
  if (!active)
    return Response.json({ error: "Sign-in link expired." }, { status: 403 });
  const target = new URL("https://connector/viewer-socket");
  target.searchParams.set("ticket", ticket);
  return connectorStub(env, workspace).fetch(
    new Request(target, {
      headers: { Upgrade: request.headers.get("Upgrade") ?? "" },
    }),
  );
}

export async function closeCanvasViewer(env: Env, workspaceId: string) {
  if (!env.CANVAS_CONNECTOR) return;
  const active = await env.DB.prepare(
    "SELECT 1 FROM canvas_connector_device WHERE workspace_id = ? AND revoked_at IS NULL",
  )
    .bind(workspaceId)
    .first();
  if (active)
    await connectorStub(env, workspaceId).fetch(
      new Request("https://connector/close", { method: "POST" }),
    );
}
