import { describe, expect, it } from "vitest";
import { validateGoogleIntegrationClaims } from "../src/google-auth";

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
