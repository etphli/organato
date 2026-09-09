import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { apiRoutes, attachmentExtension } from "../src/api";
import { getItem } from "../src/db";
import { sha256 } from "../src/security";
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
  void env;
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
  const batches: string[][] = [];
  return {
    batches,
    db: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => null,
              run: async () => ({ success: true }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch(statements: { toString(): string }[]) {
        batches.push(statements.map((statement) => statement.toString()));
        return [];
      },
    },
  };
}

function mockEnv(db: unknown, bucket: unknown) {
  return {
    DB: db,
    ATTACHMENTS: bucket,
    APP_ORIGIN: "https://organato.example",
    ALLOWED_GOOGLE_EMAILS: "owner@example.com",
    GOOGLE_CLIENT_ID: "google-client",
    CANVAS_BASE_URL: "https://canvas.example",
  } as unknown as Env;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("attachmentExtension", () => {
  it("prefers the filename extension and normalizes jpg", () => {
    expect(attachmentExtension("notes.PDF", "application/pdf")).toBe("pdf");
    expect(attachmentExtension("photo.jpg", "image/jpeg")).toBe("jpeg");
    expect(attachmentExtension("doc", "application/msword")).toBe("doc");
  });
});

describe("attachment uploads", () => {
  it("returns 501 when file storage is not configured", async () => {
    const { db } = mockDb();
    const response = await testApp(mockEnv(db, undefined)).request(
      "/items/item-1/attachments/upload",
      { method: "POST" },
    );
    expect(response.status).toBe(501);
  });

  it("returns 404 when the item does not exist", async () => {
    mockedGetItem.mockResolvedValueOnce(null);
    const { db } = mockDb();
    const bucket = { put: vi.fn(), delete: vi.fn(), getWithMetadata: vi.fn() };
    const form = new FormData();
    form.set(
      "file",
      new File(["hello"], "hello.pdf", { type: "application/pdf" }),
    );
    const response = await testApp(mockEnv(db, bucket)).request(
      "/items/missing/attachments/upload",
      { method: "POST", body: form },
    );
    expect(response.status).toBe(404);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("rejects oversized and disallowed files before storing", async () => {
    mockedGetItem.mockResolvedValue({ id: "item-1" } as any);
    const { db } = mockDb();
    const bucket = { put: vi.fn(), delete: vi.fn(), getWithMetadata: vi.fn() };
    const app = testApp(mockEnv(db, bucket));

    const big = new FormData();
    big.set(
      "file",
      new File([new ArrayBuffer(11_000_000)], "big.pdf", {
        type: "application/pdf",
      }),
    );
    const oversized = await app.request("/items/item-1/attachments/upload", {
      method: "POST",
      body: big,
    });
    expect(oversized.status).toBe(413);

    const bad = new FormData();
    bad.set("file", new File(["a,b"], "data.csv", { type: "text/csv" }));
    const disallowed = await app.request("/items/item-1/attachments/upload", {
      method: "POST",
      body: bad,
    });
    expect(disallowed.status).toBe(415);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("stores the file and links it to the item", async () => {
    mockedGetItem.mockResolvedValue({ id: "item-1", attachments: [] } as any);
    const { db, batches } = mockDb();
    const bucket = { put: vi.fn(), delete: vi.fn(), getWithMetadata: vi.fn() };
    const form = new FormData();
    form.set(
      "file",
      new File(["rubric"], "rubric.pdf", { type: "application/pdf" }),
    );
    form.set("label", "Rubric");
    form.set("linkType", "rubric");
    const response = await testApp(mockEnv(db, bucket)).request(
      "/items/item-1/attachments/upload",
      { method: "POST", body: form },
    );
    expect(response.status).toBe(201);
    expect(bucket.put).toHaveBeenCalledOnce();
    const [key] = bucket.put.mock.calls[0] as unknown as [string, unknown];
    expect(key).toMatch(/^owner@example\.com\/item-1\/.+\.pdf$/);
    expect(batches.length).toBeGreaterThan(0);
  });

  it("serves stored files only to the owning workspace", async () => {
    const fileBytes = new TextEncoder().encode("rubric");
    const bucket = {
      put: vi.fn(),
      delete: vi.fn(),
      getWithMetadata: vi.fn(async (key: string) => {
        expect(key).toBe("owner@example.com/item-1/file-id.pdf");
        return {
          value: fileBytes.buffer,
          metadata: { contentType: "application/pdf" },
        };
      }),
    };
    const db = {
      prepare(query: string) {
        return {
          bind() {
            return {
              first: async () =>
                query.includes("FROM attachment_link")
                  ? { url: "kv://owner@example.com/item-1/file-id.pdf" }
                  : null,
              run: async () => ({ success: true }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    };
    const app = testApp(mockEnv(db, bucket));
    const response = await app.request("/attachments/file-id/file");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(await response.text()).toBe("rubric");
  });

  it("refuses to serve external links through the file route", async () => {
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({ url: "https://example.com/x.pdf" }),
              run: async () => ({ success: true }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    };
    const bucket = { put: vi.fn(), delete: vi.fn(), getWithMetadata: vi.fn() };
    const app = testApp(mockEnv(db, bucket));
    const response = await app.request("/attachments/file-id/file");
    expect(response.status).toBe(404);
    expect(bucket.getWithMetadata).not.toHaveBeenCalled();
  });

  it("lets multipart uploads past the JSON gate with a valid session", async () => {
    mockedGetItem.mockReset();
    mockedGetItem.mockResolvedValue(null);
    const sessionId = "test-session-id";
    const csrf = "test-csrf";
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const sessionRow = {
      id_hash: await sha256(sessionId),
      csrf_hash: await sha256(csrf),
      authenticated_at: new Date().toISOString(),
      idle_expires_at: future,
      absolute_expires_at: future,
      email_normalized: "owner@example.com",
      workspace_id: "owner@example.com",
      display_name: "Owner",
      enabled: 1,
    };
    const db = {
      prepare(query: string) {
        return {
          bind(..._args: unknown[]) {
            return {
              first: async () =>
                query.includes("FROM session s") ? sessionRow : null,
              run: async () => ({ success: true }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    };
    const bucket = { put: vi.fn(), delete: vi.fn(), getWithMetadata: vi.fn() };
    const form = new FormData();
    form.set(
      "file",
      new File(["rubric"], "rubric.pdf", { type: "application/pdf" }),
    );
    const response = await app.request(
      "/api/items/missing/attachments/upload",
      {
        method: "POST",
        headers: {
          Origin: "https://organato.example",
          "X-CSRF-Token": csrf,
          Cookie: `organato_session=${sessionId}`,
        },
        body: form,
      },
      {
        DB: db,
        ATTACHMENTS: bucket,
        APP_ORIGIN: "https://organato.example",
        ALLOWED_GOOGLE_EMAILS: "owner@example.com",
        GOOGLE_CLIENT_ID: "google-client",
        CANVAS_BASE_URL: "https://canvas.example",
      } as unknown as Env,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as unknown as ExecutionContext,
    );
    // 404 (item missing) proves the multipart request cleared the JSON
    // gate, session, and CSRF checks; 415 would mean the gate blocked it.
    expect(response.status).toBe(404);
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
