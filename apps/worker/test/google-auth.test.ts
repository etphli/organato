import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  googleIntegrationCallback,
  googleIntegrationRoutes,
  validateGoogleIntegrationClaims,
} from "../src/google-auth";
import { encryptSecret, sha256 } from "../src/security";
import type { Env, Variables } from "../src/types";

const now = new Date("2026-07-26T10:00:00.000Z");
const validClaims = {
  email: "owner@example.com",
  email_verified: true,
  sub: "google-owner-subject",
  nonce: "expected-nonce",
  azp: "client-id",
  iat: Math.floor(now.getTime() / 1_000) - 60,
};
const expected = {
  clientId: "client-id",
  email: "owner@example.com",
  subject: "google-owner-subject",
  nonce: "expected-nonce",
  now,
};

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

describe("Google integration identity binding", () => {
  it("accepts fresh claims for the exact verified owner", () => {
    expect(validateGoogleIntegrationClaims(validClaims, expected)).toEqual({
      email: "owner@example.com",
      subject: "google-owner-subject",
    });
  });

  it.each([
    ["different email", { email: "other@example.com" }],
    ["unverified email", { email_verified: false }],
    ["different subject", { sub: "other-subject" }],
    ["different nonce", { nonce: "other-nonce" }],
    ["different authorized party", { azp: "other-client" }],
    ["stale token", { iat: Math.floor(now.getTime() / 1_000) - 16 * 60 }],
  ])("rejects a %s", (_label, patch) => {
    expect(() =>
      validateGoogleIntegrationClaims({ ...validClaims, ...patch }, expected),
    ).toThrow("google_integration_identity_mismatch");
  });

  it("rejects claims without an issued-at timestamp", () => {
    const withoutIssuedAt: Partial<typeof validClaims> = { ...validClaims };
    delete withoutIssuedAt.iat;
    expect(() =>
      validateGoogleIntegrationClaims(withoutIssuedAt, expected),
    ).toThrow("google_integration_identity_mismatch");
  });
});

describe("Google integration callback", () => {
  it("uses Cloudflare-supported manual redirect handling for token exchange", async () => {
    const state = "integration-state";
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
      return_to: "integration:owner@example.com",
      workspace_id: "owner@example.com",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const db = {
      prepare(query: string) {
        return {
          bind() {
            return {
              first: async () =>
                query.includes("FROM oauth_transaction") ? transaction : null,
              run: async () => ({ success: true }),
            };
          },
        };
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

    const response = await googleIntegrationCallback(
      new Request(
        `https://organato.example/api/integrations/google/callback?code=google-code&state=${state}`,
      ),
      env,
    );

    expect(tokenFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(400);
  });
});

describe("reminder recipients", () => {
  it("accepts a valid school address that is not an approved sign-in owner", async () => {
    let metadataJson = JSON.stringify({
      email: "sender@gmail.com",
      recipients: ["sender@gmail.com"],
    });
    const db = {
      prepare(query: string) {
        return {
          bind(...values: unknown[]) {
            return {
              first: async () =>
                query.includes("FROM integration_connection")
                  ? {
                      encrypted_credential: "encrypted-refresh-token",
                      metadata_json: metadataJson,
                      status: "healthy",
                      reconnect_needed: 0,
                      last_success_at: null,
                      last_attempt_at: null,
                      last_error_category: null,
                    }
                  : null,
              run: async () => {
                if (query.includes("UPDATE integration_connection")) {
                  metadataJson = String(values[0]);
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (context, next) => {
      context.set("user", {
        email: "friend@gmail.com",
        workspaceId: "friend@gmail.com",
        displayName: "Friend",
        csrfToken: "csrf",
        sessionIdHash: "session",
        authenticatedAt: new Date().toISOString(),
      });
      await next();
    });
    app.route("/", googleIntegrationRoutes);

    const response = await app.request(
      "/recipients",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: ["student@emanuelschool.nsw.edu.au"],
        }),
      },
      {
        DB: db,
        ALLOWED_GOOGLE_EMAILS: "friend@gmail.com",
        DEMO_MODE: "false",
      } as Env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      recipients: ["student@emanuelschool.nsw.edu.au"],
    });
  });
});
