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
