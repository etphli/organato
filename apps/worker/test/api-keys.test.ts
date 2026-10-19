import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { app } from "../src/index";
import { createSession, randomToken, sha256 } from "../src/security";
import type { Env, Variables } from "../src/types";
import type { ApiKeySummary, OrganatoItem, Subject } from "@organato/domain";

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: SQLInputValue[] = [],
  ) {}
  bind(...values: SQLInputValue[]) {
    return new Statement(this.db, this.sql, values);
  }
  async first<T>() {
    return (
      (this.db.prepare(this.sql).get(...this.values) as T | undefined) ?? null
    );
  }
  async all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.values) as T[],
      success: true,
      meta: { changes: 0 },
    };
  }
  async run() {
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(this.db.prepare(this.sql).run(...this.values).changes),
      },
    };
  }
  async execute() {
    return /^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) ? this.all() : this.run();
  }
}
class Database {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) {
    return new Statement(this.db, sql);
  }
  async batch(statements: Statement[]) {
    this.db.exec("BEGIN");
    try {
      const result = [];
      for (const s of statements) result.push(await s.execute());
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function setup() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  const owner = "ethan.likht@gmail.com";
  sqlite
    .prepare(
      "INSERT INTO allowed_identity (email_normalized, workspace_id, display_name, enabled, created_at) VALUES (?, ?, 'Owner', 1, datetime('now'))",
    )
    .run(owner, owner);
  sqlite.exec(`INSERT INTO workspace (id, name, timezone, created_at, updated_at) VALUES ('other@example.com', 'Other', 'Australia/Sydney', datetime('now'), datetime('now'));
    INSERT INTO item (id, workspace_id, kind, classification, source_type, display_name, working_status, calendar_sync_state, created_at, updated_at)
      VALUES ('other-item', 'other@example.com', 'work', 'assignment', 'manual', 'Other private item', 'not_started', 'synced', datetime('now'), datetime('now'));
    INSERT INTO subject (id, workspace_id, display_name, colour, created_at, updated_at)
      VALUES ('other-subject', 'other@example.com', 'Private subject', '#a78bfa', datetime('now'), datetime('now'));`);
  const env = {
    DB: new Database(sqlite) as unknown as D1Database,
    APP_ORIGIN: "https://organato.example",
    DEMO_MODE: "false",
    ALLOWED_GOOGLE_EMAILS: "*",
    ASSETS: { fetch: () => new Response("Asset") },
  } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const execution = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
  };
  const signIn = new Hono<{ Bindings: Env; Variables: Variables }>();
  signIn.post("/", async (c) =>
    c.json(await createSession(c, owner, "API test")),
  );
  const signedIn = await signIn.request(
    "https://organato.example/",
    { method: "POST" },
    env,
  );
  const session = await signedIn.json<{ csrfToken: string }>();
  const cookie = signedIn.headers.get("Set-Cookie")?.split(";")[0] ?? "";
  async function request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      token?: string | undefined;
      session?: boolean;
      headers?: Record<string, string>;
      rawBody?: string;
    } = {},
  ) {
    const headers = new Headers(options.headers);
    if (options.body !== undefined || options.rawBody !== undefined)
      headers.set(
        "Content-Type",
        headers.get("Content-Type") ?? "application/json",
      );
    if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
    if (options.session) {
      headers.set("Cookie", cookie);
      headers.set("Origin", env.APP_ORIGIN);
      headers.set("X-CSRF-Token", session.csrfToken);
    }
    const response = await app.request(
      `https://organato.example${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body:
          options.rawBody ??
          (options.body !== undefined ? JSON.stringify(options.body) : null),
      },
      env,
      execution,
    );
    await Promise.all(pending.splice(0));
    return response;
  }
  async function key(
    permission: "read" | "read_write" = "read_write",
    expiresAt?: string,
  ) {
    const response = await request("/api/keys", {
      method: "POST",
      session: true,
      body: { name: "Test integration", permission, expiresAt },
    });
    expect(response.status).toBe(201);
    return response.json<{ token: string; key: ApiKeySummary }>();
  }
  async function create(token: string, body: Record<string, unknown> = {}) {
    const response = await request("/api/v1/items", {
      token,
      method: "POST",
      body: {
        kind: "work",
        classification: "assignment",
        displayName: "API essay",
        ...body,
      },
    });
    expect(response.status).toBe(201);
    return (await response.json<{ item: OrganatoItem }>()).item;
  }
  return { sqlite, request, key, create, owner };
}

describe("API keys through the production request pipeline", () => {
  it("creates independent keys, stores only hashes, and never returns secrets in the list", async () => {
    const { key, request, sqlite } = await setup();
    const first = await key();
    const second = await key("read");
    expect(first.token).toMatch(/^org_[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(
      sqlite
        .prepare("SELECT token_hash FROM api_key WHERE id = ?")
        .get(first.key.id)?.token_hash,
    ).toBe(await sha256(first.token));
    const response = await request("/api/keys", { session: true });
    const text = await response.text();
    expect(text).not.toContain(first.token);
    expect(text).not.toContain("token_hash");
    expect(JSON.parse(text).keys).toHaveLength(2);
    expect(
      (await request("/api/v1/subjects", { token: second.token })).status,
    ).toBe(200);
    expect(
      sqlite
        .prepare("SELECT last_used_at FROM api_key WHERE id = ?")
        .get(second.key.id)?.last_used_at,
    ).toBeTruthy();
  });

  it("requires session, CSRF, and recent authentication to mint keys, even with an API token", async () => {
    const { request, key, sqlite } = await setup();
    const { token } = await key();
    const body = { name: "Unauthorised", permission: "read" };
    expect(
      (await request("/api/keys", { method: "POST", token, body })).status,
    ).toBe(401);
    const session = sqlite.prepare("SELECT id_hash FROM session LIMIT 1").get();
    sqlite
      .prepare("UPDATE session SET csrf_hash = ? WHERE id_hash = ?")
      .run(await sha256("changed"), session?.id_hash ?? "");
    expect(
      (await request("/api/keys", { method: "POST", session: true, body }))
        .status,
    ).toBe(403);
    sqlite
      .prepare(
        "UPDATE session SET authenticated_at = '2020-01-01T00:00:00.000Z'",
      )
      .run();
    const stale = await setup();
    await stale.key();
    stale.sqlite
      .prepare(
        "UPDATE session SET authenticated_at = '2020-01-01T00:00:00.000Z'",
      )
      .run();
    const response = await stale.request("/api/keys", {
      method: "POST",
      session: true,
      body,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "reauthentication_required",
    });
    expect((await stale.request("/api/keys", { session: true })).status).toBe(
      200,
    );
  });

  it("rejects missing, malformed, expired, revoked, and disabled-account keys with no demo bypass", async () => {
    const { request, key, sqlite } = await setup();
    const created = await key();
    for (const token of [
      undefined,
      "wrong",
      created.token.replace(/^org_./, "org_X") + "x",
    ]) {
      expect((await request("/api/v1/items", { token })).status).toBe(401);
    }
    expect((await request("/api/v1/items", { session: true })).status).toBe(
      401,
    );
    sqlite
      .prepare("UPDATE api_key SET expires_at = '2020-01-01T00:00:00.000Z'")
      .run();
    expect(
      (await request("/api/v1/items", { token: created.token })).status,
    ).toBe(401);
    const active = await key();
    expect(
      (
        await request(`/api/keys/${active.key.id}`, {
          session: true,
          method: "DELETE",
          body: {},
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/api/keys/${active.key.id}`, {
          session: true,
          method: "DELETE",
          body: {},
        })
      ).status,
    ).toBe(200);
    expect(
      (await request("/api/v1/items", { token: active.token })).status,
    ).toBe(401);
    const disabled = await key();
    sqlite.prepare("UPDATE allowed_identity SET enabled = 0").run();
    expect(
      (await request("/api/v1/items", { token: disabled.token })).status,
    ).toBe(401);
  });

  it("isolates key management and rejects invalid creation metadata", async () => {
    const { request, sqlite } = await setup();
    sqlite
      .prepare(
        "INSERT INTO allowed_identity (email_normalized, workspace_id, created_at) VALUES ('other@example.com', 'other@example.com', datetime('now'))",
      )
      .run();
    const token = `org_${randomToken()}`;
    sqlite
      .prepare(
        "INSERT INTO api_key (id, workspace_id, created_by, name, token_hash, prefix, permission, created_at) VALUES ('foreign-key', 'other@example.com', 'other@example.com', 'Foreign secret', ?, ?, 'read', ?)",
      )
      .run(await sha256(token), token.slice(0, 12), new Date().toISOString());
    expect(
      (
        await request("/api/keys/foreign-key", {
          session: true,
          method: "DELETE",
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(
      await (await request("/api/keys", { session: true })).text(),
    ).not.toContain("Foreign secret");
    const result = await (
      await request("/api/v1/items", { token })
    ).json<{ items: OrganatoItem[] }>();
    expect(result.items.map((item) => item.id)).toEqual(["other-item"]);
    for (const body of [
      { name: "  ", permission: "read" },
      { name: "Invalid", permission: "admin" },
      {
        name: "Expired",
        permission: "read",
        expiresAt: "2020-01-01T00:00:00Z",
      },
      { name: "Invalid", permission: "read", workspaceId: "other@example.com" },
    ])
      expect(
        (await request("/api/keys", { session: true, method: "POST", body }))
          .status,
      ).toBe(400);
  });

  it("enforces read-only access and keeps private browser routes unpublished", async () => {
    const { request, key } = await setup();
    const read = await key("read");
    const write = await key();
    expect(
      (
        await request("/api/v1/items", {
          token: read.token,
          method: "POST",
          body: {},
        })
      ).status,
    ).toBe(403);
    for (const path of [
      "/session",
      "/settings",
      "/export",
      "/keys",
      "/integrations",
      "/data/delete-all",
      "/items/anything/permanent-delete",
    ]) {
      expect(
        (
          await request(`/api/v1${path}`, {
            token: write.token,
            method:
              path === "/data/delete-all" || path.includes("permanent-delete")
                ? "POST"
                : "GET",
            body:
              path === "/data/delete-all" || path.includes("permanent-delete")
                ? {}
                : undefined,
          })
        ).status,
      ).toBe(404);
    }
    expect((await request("/api/items", { token: write.token })).status).toBe(
      401,
    );
  });

  it("creates and edits assignments with deadlines, priorities, notes, statuses, and optimistic version checks", async () => {
    const { request, key, create } = await setup();
    const { token, key: metadata } = await key();
    const item = await create(token, {
      dueDateLocal: "2026-12-10",
      priority: "high",
      notesMarkdown: "First draft",
    });
    const update = {
      version: item.version,
      dueAt: "2026-12-11T03:00:00Z",
      dueHasExplicitTime: true,
      priority: "urgent",
      workingStatus: "in_progress",
      notesMarkdown: "Edited via API",
      estimatedMinutes: 45,
      pinned: true,
    };
    const response = await request(`/api/v1/items/${item.id}`, {
      token,
      method: "PATCH",
      body: update,
    });
    expect(response.status).toBe(200);
    const updated = (await response.json<{ item: OrganatoItem }>()).item;
    expect(updated).toMatchObject({
      priority: "urgent",
      dueAt: "2026-12-11T03:00:00.000Z",
      dueDateLocal: null,
      dueHasExplicitTime: true,
      notesMarkdown: "Edited via API",
      workingStatus: "in_progress",
      estimatedMinutes: 45,
      pinned: true,
    });
    expect(updated.version).toBe(item.version + 1);
    expect(
      updated.history.some((entry) =>
        entry.actorIdentity.includes(metadata.id),
      ),
    ).toBe(true);
    expect(
      (
        await request(`/api/v1/items/${item.id}`, {
          token,
          method: "PATCH",
          body: update,
        })
      ).status,
    ).toBe(409);
    expect((await request("/api/v1/items/other-item", { token })).status).toBe(
      404,
    );
    expect(
      (
        await request("/api/v1/items/other-item", {
          token,
          method: "PATCH",
          body: { version: 1, priority: "urgent" },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/api/v1/items/${item.id}`, {
          token,
          method: "PATCH",
          body: { version: updated.version, subjectId: "other-subject" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/api/v1/items/${item.id}`, {
          token,
          method: "PATCH",
          body: { version: updated.version, dueDateLocal: "2026-02-30" },
        })
      ).status,
    ).toBe(400);
  });

  it("creates todos, completes recurring todos, and manages checklists, subjects, links, and archive", async () => {
    const { request, key, create } = await setup();
    const { token } = await key();
    const subjectResponse = await request("/api/v1/subjects", {
      token,
      method: "POST",
      body: { displayName: "Mathematics" },
    });
    expect(subjectResponse.status).toBe(201);
    const subject = (
      await subjectResponse.json<{ subjects: Subject[] }>()
    ).subjects.find((s) => s.displayName === "Mathematics");
    const todo = await create(token, {
      kind: "todo",
      subjectId: subject?.id,
      dueDateLocal: "2026-12-01",
      recurrenceRule: {
        frequency: "weekly",
        interval: 1,
        seriesId: "weekly-study",
      },
    });
    const subtask = await request(`/api/v1/items/${todo.id}/subtasks`, {
      token,
      method: "POST",
      body: { title: "Draft outline" },
    });
    expect(subtask.status).toBe(201);
    const sub = (await subtask.json<{ item: OrganatoItem }>()).item.subtasks[0];
    expect(
      (
        await request(`/api/v1/items/${todo.id}/subtasks/${sub?.id}`, {
          token,
          method: "PATCH",
          body: { completed: true },
        })
      ).status,
    ).toBe(200);
    const other = await create(token);
    expect(
      (
        await request(`/api/v1/items/${todo.id}/links`, {
          token,
          method: "POST",
          body: { toItemId: other.id },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(`/api/v1/items/${todo.id}/attachments`, {
          token,
          method: "POST",
          body: {
            label: "Brief",
            url: "https://example.com/brief.pdf",
            linkType: "brief",
          },
        })
      ).status,
    ).toBe(201);
    const completed = await request(`/api/v1/items/${todo.id}`, {
      token,
      method: "PATCH",
      body: { version: todo.version, workingStatus: "completed" },
    });
    expect(completed.status).toBe(200);
    const result = await completed.json<{
      item: OrganatoItem;
      nextOccurrence: OrganatoItem;
    }>();
    expect(result.item.workingStatus).toBe("completed");
    expect(result.nextOccurrence.dueDateLocal).toBe("2026-12-08");
    const archived = await request(`/api/v1/items/${todo.id}/archive`, {
      token,
      method: "POST",
      body: { version: result.item.version },
    });
    expect(archived.status).toBe(200);
    const archivedItem = (await archived.json<{ item: OrganatoItem }>()).item;
    expect(
      (
        await request(`/api/v1/items/${todo.id}/restore`, {
          token,
          method: "POST",
          body: { version: archivedItem.version },
        })
      ).status,
    ).toBe(200);
  });

  it("paginates beyond the old 2000-item cap without leaking other workspaces, and includes both classifications", async () => {
    const { request, key, sqlite, owner } = await setup();
    const { token } = await key("read");
    const insert = sqlite.prepare(
      `INSERT INTO item (id, workspace_id, kind, classification, source_type, display_name, working_status, calendar_sync_state, created_at, updated_at) VALUES (?, ?, 'work', ?, 'manual', 'Assignment', 'not_started', 'synced', datetime('now'), datetime('now'))`,
    );
    for (let i = 0; i < 2005; i++)
      insert.run(
        `page-${String(i).padStart(5, "0")}`,
        owner,
        i % 2 ? "both" : "assignment",
      );
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const response = await request(
        `/api/v1/items?classification=assignment&limit=200${cursor ? `&cursor=${cursor}` : ""}`,
        { token },
      );
      expect(response.status).toBe(200);
      const page: { items: OrganatoItem[]; nextCursor: string | null } =
        await response.json();
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toHaveLength(2005);
    expect(new Set(ids).size).toBe(2005);
    expect(ids).not.toContain("other-item");
    expect((await request("/api/v1/items?limit=201", { token })).status).toBe(
      400,
    );
    expect(
      (await request("/api/v1/items?archived=maybe", { token })).status,
    ).toBe(400);
  });

  it("limits workspace API traffic, validates bodies, and returns private JSON errors", async () => {
    const { request, key, sqlite } = await setup();
    const { token } = await key();
    expect(
      (
        await request("/api/v1/items", {
          token,
          method: "POST",
          rawBody: "not json",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/api/v1/items", {
          token,
          method: "POST",
          rawBody: "{}",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await request("/api/v1/items", {
          token,
          method: "POST",
          rawBody: JSON.stringify({ text: "x".repeat(256 * 1024) }),
        })
      ).status,
    ).toBe(413);
    sqlite
      .prepare(
        "UPDATE rate_limit SET count = 120 WHERE key LIKE 'public-api:%'",
      )
      .run();
    const response = await request("/api/v1/items", { token });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("removes keys on account data deletion so they cannot revive on a later sign-in", async () => {
    const { request, key, sqlite } = await setup();
    await key();
    const response = await request("/api/data/delete-all", {
      method: "POST",
      session: true,
      body: {
        confirmation: "Organato",
        acknowledgeExternalData: true,
        acknowledgeBackupOffer: true,
      },
    });
    expect(response.status).toBe(200);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM api_key").get()?.count,
    ).toBe(0);
  });
});
