import { readFileSync } from "node:fs";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/api";
import { provisionPersonalWorkspace } from "../src/auth";
import { getItem, getSettings, listItems, listSubjects } from "../src/db";
import { runCanvasSync } from "../src/sync";
import type { Env, Variables } from "../src/types";

class SqlitePreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new SqlitePreparedStatement(this.database, this.sql, values);
  }

  private statement(): StatementSync {
    return this.database.prepare(this.sql);
  }

  async first<T>(): Promise<T | null> {
    return (
      (this.statement().get(...(this.values as SQLInputValue[])) as
        T | undefined) ?? null
    );
  }

  async all<T>() {
    return {
      results: this.statement().all(...(this.values as SQLInputValue[])) as T[],
      success: true,
      meta: { changes: 0 },
    };
  }

  async run() {
    const result = this.statement().run(...(this.values as SQLInputValue[]));
    return {
      results: [],
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async execute() {
    return /^\s*(SELECT|WITH|PRAGMA)/i.test(this.sql) ? this.all() : this.run();
  }
}

class SqliteD1 {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SqlitePreparedStatement(this.database, sql);
  }

  async batch(statements: SqlitePreparedStatement[]) {
    const results = [];
    for (const statement of statements) results.push(await statement.execute());
    return results;
  }
}

const databases: DatabaseSync[] = [];

function tenantDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  for (const migration of [
    "0001_initial.sql",
    "0002_reminder_retry.sql",
    "0003_account_workspace_isolation.sql",
    "0004_canvas_connector.sql",
    "0005_session_auth_stamp.sql",
    "0006_subtasks_links_effort.sql",
    "0007_oauth_idempotency.sql",
    "0011_canvas_item_tombstone.sql",
  ]) {
    sqlite.exec(
      readFileSync(
        new URL(`../../../migrations/${migration}`, import.meta.url),
        {
          encoding: "utf8",
        },
      ),
    );
  }
  expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  sqlite.exec(`
    INSERT INTO workspace (id, name, timezone, settings_json, created_at, updated_at)
    VALUES ('friend@example.com', 'Organato', 'Australia/Sydney', '{"theme":"light"}', datetime('now'), datetime('now'));

    INSERT INTO subject
      (id, workspace_id, display_name, colour, active, created_at, updated_at)
    VALUES
      ('owner-subject', 'ethan.likht@gmail.com', 'Owner subject', '#a78bfa', 1, datetime('now'), datetime('now')),
      ('friend-subject', 'friend@example.com', 'Friend subject', '#3b9df8', 1, datetime('now'), datetime('now'));

    INSERT INTO item
      (id, workspace_id, kind, classification, source_type, display_name,
       subject_id, working_status, calendar_sync_state, created_at, updated_at)
    VALUES
      ('owner-item', 'ethan.likht@gmail.com', 'work', 'assignment', 'manual',
       'Private owner assignment', 'owner-subject', 'not_started', 'synced', datetime('now'), datetime('now')),
      ('friend-item', 'friend@example.com', 'work', 'assignment', 'manual',
       'Private friend assignment', 'friend-subject', 'not_started', 'synced', datetime('now'), datetime('now'));

    INSERT INTO integration_connection
      (workspace_id, provider, account_label, status, updated_at)
    VALUES
      ('ethan.likht@gmail.com', 'canvas', 'Owner Canvas', 'healthy', datetime('now')),
      ('friend@example.com', 'canvas', 'Friend Canvas', 'healthy', datetime('now'));
  `);
  return new SqliteD1(sqlite) as unknown as D1Database;
}

function tenantApi(
  db: D1Database,
  email: string,
  options: { authenticatedAt?: string; demoMode?: "true" | "false" } = {},
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (context, next) => {
    context.set("user", {
      email,
      workspaceId: email,
      displayName: email,
      csrfToken: "test-csrf",
      sessionIdHash: `session:${email}`,
      authenticatedAt: options.authenticatedAt ?? new Date().toISOString(),
    });
    await next();
  });
  app.route("/api", apiRoutes);
  const env = {
    DB: db,
    APP_ORIGIN: "https://organato.example",
    ALLOWED_GOOGLE_EMAILS: "*",
    CANVAS_BASE_URL: "https://canvas.example",
    DEMO_MODE: options.demoMode ?? "true",
  } as Env;
  return { app, env };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("per-account workspace isolation", () => {
  it("provisions a new verified account with an empty personal workspace", async () => {
    const db = tenantDatabase();
    await provisionPersonalWorkspace(db, {
      email: "new-person@example.com",
      displayName: "New Person",
      googleSubject: "google-new-person",
    });

    expect(await listItems(db, "new-person@example.com")).toEqual([]);
    expect(await listSubjects(db, "new-person@example.com")).toEqual([]);
    expect((await getSettings(db, "new-person@example.com")).theme).toBe(
      "obsidian",
    );
    const identity = await db
      .prepare(
        `SELECT workspace_id FROM allowed_identity
         WHERE email_normalized = ?`,
      )
      .bind("new-person@example.com")
      .first<{ workspace_id: string }>();
    expect(identity?.workspace_id).toBe("new-person@example.com");
  });

  it("isolates item, subject, and settings reads in the data layer", async () => {
    const db = tenantDatabase();

    const ownerItems = await listItems(db, "ethan.likht@gmail.com");
    const friendItems = await listItems(db, "friend@example.com");
    expect(ownerItems.map((item) => item.displayName)).toEqual([
      "Private owner assignment",
    ]);
    expect(friendItems.map((item) => item.displayName)).toEqual([
      "Private friend assignment",
    ]);
    expect(await getItem(db, "friend@example.com", "owner-item")).toBeNull();
    expect(
      (await listSubjects(db, "friend@example.com")).map(
        (subject) => subject.displayName,
      ),
    ).toEqual(["Friend subject"]);
    expect((await getSettings(db, "friend@example.com")).theme).toBe("light");
    expect((await getSettings(db, "ethan.likht@gmail.com")).theme).not.toBe(
      "light",
    );
  });

  it("keeps list reads lightweight while item reads include full details", async () => {
    const db = tenantDatabase();
    await db
      .prepare(
        `INSERT INTO attachment_link
          (id, item_id, label, url, link_type, created_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "friend-attachment",
        "friend-item",
        "Brief",
        "https://example.com/brief",
        "brief",
        new Date().toISOString(),
        "friend@example.com",
      )
      .run();
    await db
      .prepare(
        `INSERT INTO item_history
          (id, item_id, actor_type, actor_identity, action, summary,
           created_at, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        "friend-history",
        "friend-item",
        "user",
        "friend@example.com",
        "edited",
        "Item edited",
        new Date().toISOString(),
        "friend@example.com",
      )
      .run();

    const [summary] = await listItems(db, "friend@example.com");
    expect(summary?.attachments).toEqual([]);
    expect(summary?.history).toEqual([]);

    const detail = await getItem(db, "friend@example.com", "friend-item");
    expect(detail?.attachments).toHaveLength(1);
    expect(detail?.history).toHaveLength(1);
  });

  it("prevents cross-account reads and mutations through API routes", async () => {
    const db = tenantDatabase();
    const { app, env } = tenantApi(db, "friend@example.com");

    const itemsResponse = await app.request("/api/items", {}, env);
    expect(itemsResponse.status).toBe(200);
    const items = (await itemsResponse.json()) as {
      items: Array<{ id: string; displayName: string }>;
    };
    expect(items.items.map((item) => item.id)).toEqual(["friend-item"]);

    const privateRead = await app.request("/api/items/owner-item", {}, env);
    expect(privateRead.status).toBe(404);

    const privateMutation = await app.request(
      "/api/items/owner-item/classify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, classification: "checkpoint" }),
      },
      env,
    );
    expect(privateMutation.status).toBe(409);
    expect(
      (await getItem(db, "ethan.likht@gmail.com", "owner-item"))
        ?.classification,
    ).toBe("assignment");

    const integrations = await app.request("/api/integrations", {}, env);
    const integrationBody = (await integrations.json()) as {
      integrations: Array<{ account_label: string }>;
    };
    expect(
      integrationBody.integrations.map((row) => row.account_label),
    ).toEqual(["Friend Canvas"]);

    const canvasStatus = await app.request(
      "/api/integrations/canvas/status",
      {},
      env,
    );
    expect(canvasStatus.status).toBe(200);
  });

  it("tags new records and settings with the authenticated workspace", async () => {
    const db = tenantDatabase();
    const { app, env } = tenantApi(db, "friend@example.com");

    const created = await app.request(
      "/api/items",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "todo",
          displayName: "Friend-only todo",
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    expect(
      (await listItems(db, "friend@example.com")).map(
        (item) => item.displayName,
      ),
    ).toContain("Friend-only todo");
    expect(
      (await listItems(db, "ethan.likht@gmail.com")).map(
        (item) => item.displayName,
      ),
    ).not.toContain("Friend-only todo");

    const history = await db
      .prepare(
        `SELECT workspace_id FROM item_history
         WHERE actor_identity = ? AND action = 'created'`,
      )
      .bind("friend@example.com")
      .first<{ workspace_id: string }>();
    expect(history?.workspace_id).toBe("friend@example.com");

    const settings = await app.request(
      "/api/settings",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: "pure_black" }),
      },
      env,
    );
    expect(settings.status).toBe(200);
    expect((await getSettings(db, "friend@example.com")).theme).toBe(
      "pure_black",
    );
    expect((await getSettings(db, "ethan.likht@gmail.com")).theme).not.toBe(
      "pure_black",
    );
  });

  it("lets a valid long-lived session create and delete an assignment", async () => {
    const db = tenantDatabase();
    const { app, env } = tenantApi(db, "friend@example.com", {
      authenticatedAt: "2026-01-01T00:00:00.000Z",
      demoMode: "false",
    });

    const createdResponse = await app.request(
      "/api/items",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "work",
          classification: "assignment",
          displayName: "Long-lived session assignment",
        }),
      },
      env,
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      item: { id: string; version: number; displayName: string };
    };

    const deletedResponse = await app.request(
      `/api/items/${created.item.id}/permanent-delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: created.item.version,
          confirmation: "delete",
        }),
      },
      env,
    );

    expect(deletedResponse.status).toBe(200);
    expect(await getItem(db, "friend@example.com", created.item.id)).toBeNull();
  });

  it("does not reimport a permanently deleted Canvas assignment", async () => {
    const db = tenantDatabase();
    const { app, env } = tenantApi(db, "friend@example.com", {
      demoMode: "false",
    });
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE integration_connection
         SET encrypted_credential = NULL, metadata_json = ?, updated_at = ?
         WHERE workspace_id = ? AND provider = 'canvas'`,
      )
      .bind(
        JSON.stringify({
          transport: "browser",
          baseUrl: "https://canvas.example.edu",
          hostname: "canvas.example.edu",
          userId: "canvas-user",
          userName: "Canvas User",
          connectedAt: now,
          lastValidatedAt: now,
          credentialAad: "integration:canvas:https://canvas.example.edu",
        }),
        now,
        "friend@example.com",
      )
      .run();
    const canvasResult = {
      courses: [
        { id: "course-1", name: "English", workflowState: "available" },
      ],
      assignments: [
        {
          id: "assignment-1",
          courseId: "course-1",
          name: "Canvas essay",
          dueAt: "2026-10-01T06:00:00.000Z",
          htmlUrl:
            "https://canvas.example.edu/courses/course-1/assignments/assignment-1",
          updatedAt: now,
          published: true,
          submitted: false,
        },
      ],
      partialFailures: [],
      successfulCourseIds: ["course-1"],
      catalogueComplete: true,
      skippedMalformedItems: 0,
    };

    const firstSync = await runCanvasSync(env, "friend@example.com", "manual", {
      result: canvasResult,
      deliveryId: "delivery-1",
    });
    const importedId = firstSync.createdIds[0];
    expect(importedId).toBeDefined();
    const imported = await getItem(db, "friend@example.com", importedId!);
    expect(imported).not.toBeNull();

    const deletedResponse = await app.request(
      `/api/items/${importedId}/permanent-delete`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: imported!.version,
          confirmation: "delete",
        }),
      },
      env,
    );
    expect(deletedResponse.status).toBe(200);
    expect(await getItem(db, "friend@example.com", importedId!)).toBeNull();

    await runCanvasSync(env, "friend@example.com", "manual", {
      result: canvasResult,
      deliveryId: "delivery-2",
    });

    expect(
      (await listItems(db, "friend@example.com", { all: true })).filter(
        (item) => item.canvasAssignmentId === "assignment-1",
      ),
    ).toEqual([]);
  });
});
