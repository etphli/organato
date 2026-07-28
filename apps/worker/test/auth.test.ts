import { afterEach, describe, expect, it, vi } from "vitest";
import { authRoutes } from "../src/auth";
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "google-code", state }),
      },
      env,
    );

    expect(tokenFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
  });
});
