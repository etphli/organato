import { zValidator } from "@hono/zod-validator";
import type { ApiKeySummary } from "@organato/domain";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  randomToken,
  rateLimit,
  requireRecentSession,
  sha256,
} from "./security";
import type { Env, Variables } from "./types";

const keyColumns = `id, name, prefix, permission, created_at AS createdAt,
  expires_at AS expiresAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt`;
const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    permission: z.enum(["read", "read_write"]),
    expiresAt: z.string().datetime().nullable().default(null),
  })
  .strict();

// Mounted behind browser session and CSRF middleware only.
export const apiKeyRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

apiKeyRoutes.get("/", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT ${keyColumns} FROM api_key WHERE workspace_id = ? ORDER BY created_at DESC, id`,
  )
    .bind(c.get("user").workspaceId)
    .all<ApiKeySummary>();
  return c.json({ keys: result.results });
});

apiKeyRoutes.post(
  "/",
  requireRecentSession(),
  zValidator("json", createKeySchema),
  async (c) => {
    const input = c.req.valid("json");
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
      return c.json({ error: "Expiry must be in the future." }, 400);
    }
    const user = c.get("user");
    if (!(await rateLimit(c, `api-key-create:${user.workspaceId}`, 20, 1))) {
      c.header("Retry-After", "60");
      return c.json(
        { error: "Too many keys created. Try again in a minute." },
        429,
      );
    }
    const token = `org_${randomToken(32)}`;
    const key: ApiKeySummary = {
      id: crypto.randomUUID(),
      name: input.name,
      prefix: token.slice(0, 12),
      permission: input.permission,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt
        ? new Date(input.expiresAt).toISOString()
        : null,
      lastUsedAt: null,
      revokedAt: null,
    };
    await c.env.DB.prepare(
      `INSERT INTO api_key (id, workspace_id, created_by, name, token_hash, prefix,
      permission, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        key.id,
        user.workspaceId,
        user.email,
        key.name,
        await sha256(token),
        key.prefix,
        key.permission,
        key.createdAt,
        key.expiresAt,
      )
      .run();
    return c.json({ key, token }, 201);
  },
);

apiKeyRoutes.delete("/:id", async (c) => {
  // Revocation stays available even when the session needs reauthentication.
  const result = await c.env.DB.prepare(
    `UPDATE api_key SET revoked_at = COALESCE(revoked_at, ?)
     WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      new Date().toISOString(),
      c.req.param("id"),
      c.get("user").workspaceId,
    )
    .run();
  return result.meta.changes
    ? c.json({ ok: true })
    : c.json({ error: "API key not found." }, 404);
});

apiKeyRoutes.onError((error, c) => {
  if (error instanceof HTTPException)
    return c.json({ error: error.message }, error.status);
  throw error;
});
