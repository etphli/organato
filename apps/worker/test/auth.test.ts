import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authRoutes,
  clientSignInMessage,
  isConfiguredGoogleEmailAllowed,
} from "../src/auth";
import { encryptSecret, sha256 } from "../src/security";
import type { Env } from "../src/types";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google sign-in access policy", () => {
  it("accepts every verified email when the allow-list contains a wildcard", () => {
    expect(
      isConfiguredGoogleEmailAllowed(
        { ALLOWED_GOOGLE_EMAILS: "*" },
        "friend@example.com",
      ),
    ).toBe(true);
  });

  it("keeps exact-address allow-lists available for private deployments", () => {
    const env = { ALLOWED_GOOGLE_EMAILS: "owner@example.com" };
    expect(isConfiguredGoogleEmailAllowed(env, "OWNER@example.com")).toBe(true);
    expect(isConfiguredGoogleEmailAllowed(env, "friend@example.com")).toBe(
      false,
    );
  });
});

describe("Google sign-in exchange", () => {
  it("uses a redirect mode supported by the Cloudflare Workers runtime", async () => {
    const state = "oauth-state";
    const stateHash = await sha256(state);
    const key = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const transaction = {
      nonce_encrypted: await encryptSecret(
        "nonce",
        key,
        `oidc:${stateHash}:nonce`,
      ),
      code_verifier_encrypted: await encryptSecret(
        "verifier",
        key,
        `oidc:${stateHash}:verifier`,
      ),
      return_to: "/",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const db = {
      prepare(query: string) {
        return {
          bind() {
            return {
              first: async () =>
                query.includes("FROM oauth_transaction") ? transaction : null,
              run: async () => ({ success: true, meta: { changes: 1 } }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;
    const env = {
      DB: db,
      APP_ORIGIN: "https://organato.example",
      ALLOWED_GOOGLE_EMAILS: "owner@example.com",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      SESSION_SECRET: "session-secret",
      DATA_ENCRYPTION_KEY: key,
      CANVAS_BASE_URL: "https://canvas.example",
    } as Env;
    const tokenFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_input, init) => {
        expect(init?.redirect).toBe("manual");
        return new Response(null, { status: 400 });
      });

    const response = await authRoutes.request(
      "https://organato.example/google/exchange",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://organato.example",
        },
        body: JSON.stringify({ code: "google-code", state }),
      },
      env,
    );

    expect(tokenFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
  });
});

describe("client sign-in messages", () => {
  it("keeps actionable wording for allow-list and expiry failures", () => {
    expect(
      clientSignInMessage({
        message: "This Google account has not been approved for Organato.",
        reason: "email_not_allowed",
      }),
    ).toBe("This Google account has not been approved for Organato.");
    expect(
      clientSignInMessage({
        message: "Google sign-in expired. Start again.",
        reason: "expired_transaction",
      }),
    ).toBe("Google sign-in expired. Start again.");
    expect(
      clientSignInMessage({
        message: "Sign-in is already completing. Wait a moment and try again.",
        reason: "exchange_in_progress",
      }),
    ).toBe("Sign-in is already completing. Wait a moment and try again.");
  });

  it("masks everything else with a generic message", () => {
    expect(
      clientSignInMessage({
        message: "Google identity is disabled.",
        reason: "identity_disabled",
      }),
    ).toBe("Google sign-in could not finish. Please try again.");
    expect(
      clientSignInMessage({
        message: "Subjects do not match.",
        reason: "google_subject_mismatch",
      }),
    ).toBe("Google sign-in could not finish. Please try again.");
  });
});

describe("OAuth completion idempotency", () => {
  function exchangeDb(options: {
    transaction?: Record<string, unknown> | null;
    completed?: Record<string, unknown> | null;
    claimedChanges?: number;
  }) {
    return {
      prepare(query: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (query.includes("FROM completed_oauth_exchange")) {
                  return options.completed ?? null;
                }
                if (query.includes("FROM oauth_transaction")) {
                  return options.transaction ?? null;
                }
                return null;
              },
              run: async () => ({
                success: true,
                meta: { changes: options.claimedChanges ?? 1 },
              }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
      async batch() {
        return [];
      },
    } as unknown as D1Database;
  }

  function exchangeEnv(db: D1Database) {
    return {
      DB: db,
      APP_ORIGIN: "https://organato.example",
      ALLOWED_GOOGLE_EMAILS: "*",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      DATA_ENCRYPTION_KEY: "key",
      CANVAS_BASE_URL: "https://canvas.example",
    } as Env;
  }

  it("returns cached success instead of expired for replays", async () => {
    const db = exchangeDb({
      transaction: null,
      completed: {
        csrf_token: "cached-csrf",
        return_to: "/calendar",
      },
    });
    const response = await authRoutes.request(
      "https://organato.example/google/exchange",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://organato.example",
        },
        body: JSON.stringify({ code: "google-code", state: "oauth-state" }),
      },
      exchangeEnv(db),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      authenticated: boolean;
      csrfToken: string;
      returnTo: string;
    };
    expect(body).toMatchObject({
      authenticated: true,
      csrfToken: "cached-csrf",
      returnTo: "/calendar",
    });
  });

  it("reports in-progress when a twin submission holds the claim", async () => {
    const db = exchangeDb({
      transaction: {
        nonce_encrypted: "x",
        code_verifier_encrypted: "y",
        return_to: "/",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        claimed_at: new Date().toISOString(),
      },
      completed: null,
      claimedChanges: 0,
    });
    const response = await authRoutes.request(
      "https://organato.example/google/exchange",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://organato.example",
        },
        body: JSON.stringify({ code: "google-code", state: "oauth-state" }),
      },
      exchangeEnv(db),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("already completing");
  });
});
