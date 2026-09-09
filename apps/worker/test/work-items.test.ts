import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRoutes } from "../src/api";
import { getItem } from "../src/db";
import type { Env, Variables } from "../src/types";

vi.mock("../src/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/db")>();
  return { ...actual, getItem: vi.fn() };
});

vi.mock("../src/security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/security")>();
  return { ...actual, rateLimit: async () => true };
});

const mockedGetItem = vi.mocked(getItem);

function testApp(env: Env) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (context, next) => {
    context.set("user", {
      email: "owner@example.com",
      workspaceId: "owner@example.com",
      displayName: "Owner",
      csrfToken: "csrf",
      sessionIdHash: "session",
      authenticatedAt: new Date().toISOString(),
    });
    await next();
  });
  app.route("/", apiRoutes);
  const boundEnv = env;
  return {
    request: (input: string, init?: RequestInit) =>
      app.request(input, init, boundEnv),
  };
}

function mockDb() {
  return {
    prepare(query: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (query.includes("MAX(sort_rank)")) return { max_rank: 0 };
              return null;
            },
            run: async () => ({ success: true, meta: { changes: 1 } }),
            all: async () => {
              if (query.includes("display_name")) {
                return {
                  results: [
                    {
                      id: "item-1",
                      display_name: "English essay",
                      working_status: "not_started",
                    },
                  ],
                };
              }
              if (query.includes("item_history")) {
                return {
                  results: [
                    {
                      summary: "Moved to Friday",
                      action: "canvas_source_updated",
                      created_at: "2026-01-01T00:00:00.000Z",
                      item_id: "item-1",
                      display_name: "English essay",
                    },
                  ],
                };
              }
              return { results: [] };
            },
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
}

function mockEnv(db: unknown) {
  return {
    DB: db,
    APP_ORIGIN: "https://organato.example",
    ALLOWED_GOOGLE_EMAILS: "owner@example.com",
    GOOGLE_CLIENT_ID: "google-client",
    CANVAS_BASE_URL: "https://canvas.example",
  } as unknown as Env;
}

const fakeItem = (id: string) =>
  ({ id, notesMarkdown: "", displayName: `Item ${id}` }) as never;

afterEach(() => {
  vi.clearAllMocks();
});

describe("subtask routes", () => {
  it("creates a subtask for an owned item", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/subtasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Draft" }),
      },
    );
    expect(response.status).toBe(201);
  });

  it("rejects an empty title", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/subtasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "  " }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("toggles a subtask", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/subtasks/sub-1",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      },
    );
    expect(response.status).toBe(200);
  });

  it("404s on a missing item", async () => {
    mockedGetItem.mockResolvedValue(null);
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/missing/subtasks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Draft" }),
      },
    );
    expect(response.status).toBe(404);
  });
});

describe("item link routes", () => {
  it("refuses self-links and cycles", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const app = testApp(mockEnv(mockDb()));
    const selfLink = await app.request("/items/item-1/links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toItemId: "item-1" }),
    });
    expect(selfLink.status).toBe(400);
  });

  it("creates a dependency between two owned items", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/links",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toItemId: "item-2" }),
      },
    );
    expect(response.status).toBe(201);
  });
});

describe("merge route", () => {
  it("merges a duplicate into the survivor", async () => {
    mockedGetItem.mockResolvedValue(fakeItem("item-1"));
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/merge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateId: "item-2" }),
      },
    );
    expect(response.status).toBe(200);
  });

  it("refuses self-merge", async () => {
    const response = await testApp(mockEnv(mockDb())).request(
      "/items/item-1/merge",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateId: "item-1" }),
      },
    );
    expect(response.status).toBe(400);
  });
});

describe("unified search", () => {
  it("returns items and history matches", async () => {
    const response = await testApp(mockEnv(mockDb())).request(
      "/search/all?q=essay",
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: unknown[];
      history: unknown[];
    };
    expect(body.items).toHaveLength(1);
    expect(body.history).toHaveLength(1);
  });

  it("returns empty results for short queries", async () => {
    const response = await testApp(mockEnv(mockDb())).request(
      "/search/all?q=x",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], history: [] });
  });
});
