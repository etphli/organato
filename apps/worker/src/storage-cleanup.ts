import type { Env } from "./types";

export function storageKeyFromUrl(url: string | null): string | null {
  if (!url || !url.startsWith("kv://")) return null;
  return url.slice("kv://".length);
}

export async function enqueueStorageDeletions(
  db: D1Database,
  workspaceId: string,
  keys: readonly string[],
  now = new Date(),
): Promise<void> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return;
  const timestamp = now.toISOString();
  const statements = unique.map((key) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO storage_deletion_queue
          (id, workspace_id, storage_key, attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .bind(`${workspaceId}:${key}`, workspaceId, key, timestamp, timestamp),
  );
  const chunks: D1PreparedStatement[][] = [];
  for (let i = 0; i < statements.length; i += 50) {
    chunks.push(statements.slice(i, i + 50));
  }
  for (const chunk of chunks) {
    await db.batch(chunk);
  }
}

export async function drainStorageDeletions(
  env: Env,
  limit = 100,
): Promise<{ deleted: number; pending: number }> {
  if (!env.ATTACHMENTS) return { deleted: 0, pending: 0 };
  const now = new Date();
  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, storage_key, attempts
     FROM storage_deletion_queue
     WHERE next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`,
  )
    .bind(now.toISOString(), limit)
    .all<{
      id: string;
      workspace_id: string;
      storage_key: string;
      attempts: number;
    }>();
  let deleted = 0;
  for (const row of rows.results) {
    try {
      await env.ATTACHMENTS.delete(row.storage_key);
      await env.DB.prepare(`DELETE FROM storage_deletion_queue WHERE id = ?`)
        .bind(row.id)
        .run();
      deleted += 1;
    } catch {
      const attempts = row.attempts + 1;
      const backoffMinutes = Math.min(24 * 60, 5 * 2 ** Math.min(attempts, 8));
      await env.DB.prepare(
        `UPDATE storage_deletion_queue SET attempts = ?,
           next_attempt_at = ? WHERE id = ?`,
      )
        .bind(
          attempts,
          new Date(now.getTime() + backoffMinutes * 60_000).toISOString(),
          row.id,
        )
        .run()
        .catch(() => undefined);
    }
  }
  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM storage_deletion_queue`,
  )
    .first<{ count: number }>()
    .catch(() => ({ count: 0 }));
  return { deleted, pending: Number(remaining?.count ?? 0) };
}
