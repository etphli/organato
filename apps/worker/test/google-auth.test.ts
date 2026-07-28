import { afterEach, describe, expect, it, vi } from "vitest";
import {
  googleIntegrationCallback,
  validateGoogleIntegrationClaims,
} from "../src/google-auth";
import { encryptSecret, sha256 } from "../src/security";
import type { Env } from "../src/types";

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
