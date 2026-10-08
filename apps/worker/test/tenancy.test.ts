import { readFileSync } from "node:fs";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { Hono } from "hono";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRoutes } from "../src/api";
import { aiRoutes } from "../src/ai";
import { provisionPersonalWorkspace } from "../src/auth";
import { getItem, getSettings, listItems, listSubjects } from "../src/db";
import { runCanvasSync, resolveCalendarConflict } from "../src/sync";
import type { Env, Variables } from "../src/types";

const calendarMock = vi.hoisted(() => ({
  fail: false,
  pushed: new Array<{ summary: string; etag: string | undefined }>(),
}));
const deletedGoogleEvents = vi.hoisted(() => new Array<string>());

vi.mock("../src/google-connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/google-connection")>()),
  loadGoogleConnection: async () => ({
    metadata: { email: "friend@example.com", calendarId: "test-calendar" },
    calendar: {
      listChanges: async () => ({ events: [] }),
      getEvent: async () => ({
        id: "test-event",
        etag: "latest",
        status: "confirmed",
        summary: "Latest Google title",
        start: { dateTime: "2026-10-01T00:00:00Z" },
      }),
      upsertEvent: async (
        _id: string,
        projection: { summary: string },
        _eventId?: string,
        etag?: string,
      ) => {
        if (calendarMock.fail) throw new Error("Google unavailable");
        calendarMock.pushed.push({ summary: projection.summary, etag });
        return { id: "test-event", etag: "saved" };
      },
      deleteEvent: async (_calendarId: string, eventId: string) => {
        deletedGoogleEvents.push(eventId);
      },
    },
  }),
}));

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
    "0008_calendar_conflict.sql",
    "0009_storage_deletion_queue.sql",
    "0010_attachment_size.sql",
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
  app.route("/api/ai", aiRoutes);
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
  calendarMock.fail = false;
  calendarMock.pushed.length = 0;
  for (const database of databases.splice(0)) database.close();
  deletedGoogleEvents.length = 0;
});

describe("per-account workspace isolation", () => {
  it("reads all legacy assignments once without changing records or related data", async () => {
    const db = tenantDatabase();
    const sqlite = databases.at(-1);
    if (!sqlite) throw new Error("Database fixture was not created");
    sqlite.exec(`
      UPDATE item SET classification = 'checkpoint', notes_markdown = 'Keep my notes', due_date_local = '2026-10-15', canvas_assignment_id = 'canvas-original' WHERE id = 'friend-item';
      INSERT INTO item (id, workspace_id, kind, classification, source_type, display_name, working_status, created_at, updated_at)
      VALUES ('friend-both', 'friend@example.com', 'work', 'both', 'manual', 'Combined work', 'in_progress', datetime('now'), datetime('now'));
      INSERT INTO subtask (id, workspace_id, item_id, title, completed, created_at, updated_at)
      VALUES ('step', 'friend@example.com', 'friend-item', 'Existing step', 1, datetime('now'), datetime('now'));
      INSERT INTO attachment_link (id, workspace_id, item_id, label, url, link_type, created_at)
      VALUES ('attachment', 'friend@example.com', 'friend-item', 'Notes', 'https://example.com/notes', 'external', datetime('now'));
      INSERT INTO item_history (id, workspace_id, item_id, actor_type, actor_identity, action, summary, created_at)
      VALUES ('history', 'friend@example.com', 'friend-item', 'user', 'friend@example.com', 'edited', 'Existing history', datetime('now'));
      INSERT INTO field_override (workspace_id, item_id, field_name, override_value_json, origin, created_at, updated_at)
      VALUES ('friend@example.com', 'friend-item', 'displayName', '"Private friend assignment"', 'organato', datetime('now'), datetime('now'));
      INSERT INTO calendar_link (workspace_id, item_id, google_calendar_id, google_event_id, sync_state)
      VALUES ('friend@example.com', 'friend-item', 'calendar', 'event-original', 'synced');
      INSERT INTO item_link (id, workspace_id, from_item_id, to_item_id, created_at)
      VALUES ('dependency', 'friend@example.com', 'friend-item', 'friend-both', datetime('now'));
      INSERT INTO saved_view (id, workspace_id, page, name, created_at, updated_at)
      VALUES ('legacy-view', 'friend@example.com', 'checkpoints', 'Existing view', datetime('now'), datetime('now'));
    `);
    const tables = [
      "item",
      "subtask",
      "attachment_link",
      "item_history",
      "field_override",
      "calendar_link",
      "item_link",
      "saved_view",
      "workspace",
    ];
    const snapshot = () =>
      tables.map((table) =>
        sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      );
    const before = snapshot();
    const { app, env } = tenantApi(db, "friend@example.com");
    const response = await app.request("/api/home", {}, env);
    expect(response.status).toBe(200);
    const body = z
      .object({ assignments: z.array(z.object({ id: z.string() })) })
      .parse(await response.json());
    expect(body.assignments.map((item) => item.id).toSorted()).toEqual([
      "friend-both",
      "friend-item",
    ]);
    const checkpoint = await getItem(db, "friend@example.com", "friend-item");
    expect(checkpoint).toMatchObject({
      classification: "checkpoint",
      canvasAssignmentId: "canvas-original",
      notesMarkdown: "Keep my notes",
      dueDateLocal: "2026-10-15",
      subtasks: [{ id: "step", completed: true }],
      attachments: [{ id: "attachment" }],
      history: [{ id: "history" }],
      overrides: [{ fieldName: "displayName" }],
    });
    expect(snapshot()).toEqual(before);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  });

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

  it.each(["assignment", "checkpoint"] as const)(
    "does not reimport a permanently deleted Canvas %s",
    async (classification) => {
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
            dueAt: "2020-01-01T06:00:00.000Z",
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

      const firstSync = await runCanvasSync(
        env,
        "friend@example.com",
        "manual",
        {
          result: canvasResult,
          deliveryId: "delivery-1",
        },
      );
      const importedId = firstSync.createdIds[0];
      expect(importedId).toBeDefined();
      const imported = await getItem(db, "friend@example.com", importedId!);
      expect(imported).not.toBeNull();
      const classifiedResponse = await app.request(
        `/api/items/${importedId}/classify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: imported!.version,
            classification,
          }),
        },
        env,
      );
      expect(classifiedResponse.status).toBe(200);
      const classified = (await classifiedResponse.json()) as {
        item: { version: number; classification: string };
      };
      expect(classified.item.classification).toBe(classification);
      await db
        .prepare(
          `INSERT INTO calendar_link
            (item_id, workspace_id, google_calendar_id, google_event_id, sync_state)
           VALUES (?, ?, 'test-calendar', 'test-event', 'synced')`,
        )
        .bind(importedId, "friend@example.com")
        .run();

      const deletedResponse = await app.request(
        `/api/items/${importedId}/permanent-delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: classified.item.version,
            confirmation: "delete",
          }),
        },
        env,
      );
      expect(deletedResponse.status).toBe(200);
      expect(deletedGoogleEvents).toEqual(["test-event"]);
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
    },
  );
});

describe("calendar conflict resolution", () => {
  async function conflict() {
    const db = tenantDatabase();
    const { env } = tenantApi(db, "friend@example.com");
    await db
      .prepare(
        "UPDATE item SET due_at='2026-10-01T00:00:00Z', calendar_enabled=1, calendar_sync_state='conflict' WHERE id='friend-item'",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO calendar_link (item_id, workspace_id, google_calendar_id, google_event_id, google_etag, sync_state) VALUES ('friend-item', 'friend@example.com', 'test-calendar', 'test-event', 'stale', 'conflict')",
      )
      .run();
    return { db, env };
  }
  it("writes the chosen Organato version to Google before reporting resolved", async () => {
    const { db, env } = await conflict();
    expect(
      await resolveCalendarConflict(
        env,
        "friend@example.com",
        "friend-item",
        "mine",
      ),
    ).toEqual({ resolved: true });
    expect(calendarMock.pushed).toEqual([
      { summary: "Private friend assignment", etag: "latest" },
    ]);
    expect(
      (await getItem(db, "friend@example.com", "friend-item"))
        ?.calendarSyncState,
    ).toBe("synced");
  });
  it("keeps a conflict actionable when the Google write fails", async () => {
    const { db, env } = await conflict();
    calendarMock.fail = true;
    await expect(
      resolveCalendarConflict(env, "friend@example.com", "friend-item", "mine"),
    ).rejects.toThrow("Google unavailable");
    expect(
      (await getItem(db, "friend@example.com", "friend-item"))
        ?.calendarSyncState,
    ).toBe("conflict");
  });
  it("reads the current Google version and isolates other workspaces", async () => {
    const { db, env } = await conflict();
    expect(
      await resolveCalendarConflict(
        env,
        "ethan.likht@gmail.com",
        "friend-item",
        "theirs",
      ),
    ).toEqual({ resolved: false });
    expect(
      await resolveCalendarConflict(
        env,
        "friend@example.com",
        "friend-item",
        "theirs",
      ),
    ).toEqual({ resolved: true });
    expect(
      (await getItem(db, "friend@example.com", "friend-item"))?.displayName,
    ).toBe("Latest Google title");
  });
});

describe("AI planning with real workspace data", () => {
  afterEach(() => vi.unstubAllGlobals());
  const body = (value: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const liveApi = () => {
    const db = tenantDatabase();
    const { app, env } = tenantApi(db, "friend@example.com", {
      demoMode: "false",
    });
    env.AI_ENABLED = "true";
    env.OPENROUTER_API_KEY = "test-provider-key";
    return { app, env, db };
  };
  const completion = (suggestion: unknown) =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(suggestion) } }],
      }),
      { headers: { "Content-Type": "application/json" } },
    );

  it("keeps AI off by default and refuses a paid model", async () => {
    const { app, env } = liveApi();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    env.AI_ENABLED = "false";
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "Do homework" }),
          env,
        )
      ).status,
    ).toBe(503);
    env.AI_ENABLED = "true";
    env.OPENROUTER_MODEL = "paid/model";
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "Do homework" }),
          env,
        )
      ).status,
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends only the owner's requested context and restricts routing to zero cost", async () => {
    const { app, env } = liveApi();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        completion({ steps: [{ title: "Make an outline", minutes: 20 }] }),
      );
    vi.stubGlobal("fetch", fetcher);
    const response = await app.request(
      "/api/ai/suggest",
      body({
        kind: "breakdown",
        itemId: "friend-item",
        brief: "Write an essay",
      }),
      env,
    );
    expect(response.status).toBe(200);
    const [, init] = fetcher.mock.calls[0] ?? [];
    const payload = JSON.parse(init.body);
    expect(payload.model).toMatch(/:free$/);
    expect(payload.provider).toEqual({
      max_price: { prompt: 0, completion: 0, request: 0 },
      allow_fallbacks: false,
    });
    expect(init.headers.Authorization).toBe("Bearer test-provider-key");
    expect(payload.messages[1].content).toContain("Private friend assignment");
    expect(payload.messages[1].content).not.toContain(
      "Private owner assignment",
    );
    expect(payload.messages[1].content).not.toContain("notesMarkdown");
    expect(JSON.stringify(await response.json())).not.toContain(
      "test-provider-key",
    );
  });

  it("rejects another tenant's assignment before contacting OpenRouter", async () => {
    const { app, env } = liveApi();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "breakdown", itemId: "owner-item", brief: "" }),
          env,
        )
      ).status,
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects hallucinated subject IDs, invalid dates and unrelated recommendations", async () => {
    const { app, env } = liveApi();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const task = {
      name: "Draft",
      subjectId: "owner-subject",
      date: null,
      time: null,
      priority: null,
      clarification: null,
    };
    fetcher.mockResolvedValueOnce(completion(task));
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "Draft" }),
          env,
        )
      ).status,
    ).toBe(502);
    fetcher.mockResolvedValueOnce(
      completion({ ...task, subjectId: null, date: "2026-02-30" }),
    );
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "Draft" }),
          env,
        )
      ).status,
    ).toBe(502);
    fetcher.mockResolvedValueOnce(
      completion({
        itemId: "owner-item",
        action: "Draft",
        reason: "Urgent",
        minutes: 15,
      }),
    );
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "next", minutes: 15 }),
          env,
        )
      ).status,
    ).toBe(502);
  });

  it("bounds requests and output and does not retry provider rate limits", async () => {
    const { app, env } = liveApi();
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 429 }));
    vi.stubGlobal("fetch", fetcher);
    const first = await app.request(
      "/api/ai/suggest",
      body({ kind: "task", text: "Draft" }),
      env,
    );
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({
      error: expect.stringContaining("limit"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 3; index++)
      await app.request(
        "/api/ai/suggest",
        body({ kind: "task", text: "Draft" }),
        env,
      );
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "Draft" }),
          env,
        )
      ).status,
    ).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(
      (
        await app.request(
          "/api/ai/suggest",
          body({ kind: "task", text: "x".repeat(13000) }),
          env,
        )
      ).status,
    ).toBe(413);
  });

  it("adds accepted checklist steps once across retries and preserves existing work", async () => {
    const { app, env, db } = liveApi();
    const before = await getItem(db, "friend@example.com", "friend-item");
    const steps = [
      { id: crypto.randomUUID(), title: "My edited first step" },
      { id: crypto.randomUUID(), title: "Proofread" },
    ];
    for (let index = 0; index < 2; index++) {
      expect(
        (
          await app.request(
            "/api/items/friend-item/subtasks/batch",
            body({ steps }),
            env,
          )
        ).status,
      ).toBe(201);
    }
    const after = await getItem(db, "friend@example.com", "friend-item");
    expect(after?.subtasks.map((step) => step.title)).toEqual(
      steps.map((step) => step.title),
    );
    expect(after?.dueAt).toBe(before?.dueAt);
    expect(after?.classification).toBe(before?.classification);
    expect(after?.notesMarkdown).toBe(before?.notesMarkdown);
    expect(
      (
        await app.request(
          "/api/items/owner-item/subtasks/batch",
          body({ steps }),
          env,
        )
      ).status,
    ).toBe(404);
    expect(
      (await getItem(db, "ethan.likht@gmail.com", "owner-item"))?.subtasks,
    ).toEqual([]);
  });
});
