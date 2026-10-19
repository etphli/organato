import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { apiRoutes } from "./api";
import { listItems } from "./db";
import { rateLimit, sha256 } from "./security";
import type { Env, Variables } from "./types";

// Every published method/path is explicit. New browser routes are private by default.
const publishedRoutes = new Set([
  "GET /items",
  "POST /items",
  "GET /items/:id",
  "PATCH /items/:id",
  "POST /items/:id/classify",
  "POST /items/:id/archive",
  "POST /items/:id/restore",
  "POST /items/:id/subtasks",
  "PATCH /items/:id/subtasks/:subtaskId",
  "DELETE /items/:id/subtasks/:subtaskId",
  "POST /items/:id/links",
  "DELETE /items/:id/links/:linkId",
  "POST /items/:id/attachments",
  "DELETE /items/:id/attachments/:attachmentId",
  "GET /subjects",
  "POST /subjects",
  "PATCH /subjects/:id",
]);
const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.string().min(1).max(200).optional(),
    archived: z.enum(["true", "false"]).default("false"),
    kind: z.enum(["work", "todo"]).optional(),
    classification: z
      .enum(["unclassified", "assignment", "checkpoint", "both"])
      .optional(),
  })
  .strict();

export const publicApiRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

publicApiRoutes.use("*", async (c, next) => {
  const authorization = c.req.header("Authorization") ?? "";
  const match = /^Bearer (org_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  const token = match?.[1];
  if (!token) {
    c.header("WWW-Authenticate", "Bearer");
    return c.json({ error: "A valid API bearer key is required." }, 401);
  }
  const now = new Date().toISOString();
  const key = await c.env.DB.prepare(
    `SELECT k.id, k.workspace_id, k.permission, k.created_by
     FROM api_key k JOIN allowed_identity a
       ON a.email_normalized = k.created_by AND a.workspace_id = k.workspace_id
     WHERE k.token_hash = ? AND k.revoked_at IS NULL
       AND (k.expires_at IS NULL OR k.expires_at > ?) AND a.enabled = 1`,
  )
    .bind(await sha256(token), now)
    .first<{
      id: string;
      workspace_id: string;
      permission: "read" | "read_write";
      created_by: string;
    }>();
  if (!key) {
    c.header("WWW-Authenticate", "Bearer");
    return c.json(
      { error: "The API key is invalid, expired, or revoked." },
      401,
    );
  }
  if (!(await rateLimit(c, `public-api:${key.workspace_id}`, 120, 1))) {
    c.header("Retry-After", "60");
    return c.json(
      { error: "API request limit reached. Try again in a minute." },
      429,
    );
  }
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    key.permission !== "read_write"
  ) {
    return c.json({ error: "This API key has read-only access." }, 403);
  }
  if (
    !["GET", "HEAD"].includes(c.req.method) &&
    !/^application\/json(?:\s*;|$)/i.test(c.req.header("Content-Type") ?? "")
  ) {
    return c.json({ error: "Expected an application/json request." }, 415);
  }
  c.set("user", {
    email: `${key.created_by} [API key ${key.id}]`,
    workspaceId: key.workspace_id,
    displayName: "API integration",
    apiKeyId: key.id,
  });
  await c.env.DB.prepare("UPDATE api_key SET last_used_at = ? WHERE id = ?")
    .bind(now, key.id)
    .run();
  await next();
});
publicApiRoutes.use(
  "*",
  bodyLimit({
    maxSize: 256 * 1024,
    onError: (c) => c.json({ error: "Request body exceeds 256 KiB." }, 413),
  }),
);

publicApiRoutes.get("/items", async (c) => {
  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success)
    return c.json(
      { error: "Invalid list parameters.", details: parsed.error.flatten() },
      400,
    );
  const query = parsed.data;
  const result = await c.env.DB.prepare(
    `SELECT id FROM item WHERE workspace_id = ?
      AND ${query.archived === "true" ? "archived_at IS NOT NULL" : "archived_at IS NULL"}
      AND id > ? AND (? IS NULL OR kind = ?)
      AND (? IS NULL OR classification = ? OR (? IN ('assignment', 'checkpoint') AND classification = 'both'))
      ORDER BY id LIMIT ?`,
  )
    .bind(
      c.get("user").workspaceId,
      query.cursor ?? "",
      query.kind ?? null,
      query.kind ?? null,
      query.classification ?? null,
      query.classification ?? null,
      query.classification ?? null,
      query.limit + 1,
    )
    .all<{ id: string }>();
  const ids = result.results.slice(0, query.limit).map((row) => row.id);
  const items = ids.length
    ? await listItems(c.env.DB, c.get("user").workspaceId, {
        archived: query.archived === "true",
        ids,
        limit: query.limit,
        includeDetails: true,
      })
    : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return c.json({
    items: ids.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    }),
    nextCursor: result.results.length > query.limit ? ids.at(-1) : null,
  });
});

// Register only reviewed handlers, including their existing validators and version checks.
for (const route of apiRoutes.routes) {
  if (route.path === "/items" && route.method === "GET") continue;
  if (publishedRoutes.has(`${route.method} ${route.path}`)) {
    publicApiRoutes.on(route.method, route.path, route.handler);
  }
}
publicApiRoutes.all("*", (c) =>
  c.json({ error: "API endpoint not found." }, 404),
);

publicApiRoutes.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  throw error;
});
