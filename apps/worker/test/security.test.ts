import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hasRecentAuthentication,
  requestMatchesOrigin,
  sha256,
} from "../src/security";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

describe("credential envelopes", () => {
  it("binds ciphertext to provider AAD", async () => {
    const key = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const encrypted = await encryptSecret(
      "private-token",
      key,
      "provider:record",
    );
    await expect(
      decryptSecret(encrypted, key, "provider:record"),
    ).resolves.toBe("private-token");
    await expect(
      decryptSecret(encrypted, key, "other-record"),
    ).rejects.toThrow();
  });

  it("hashes opaque session identifiers", async () => {
    expect(await sha256("session")).not.toContain("session");
  });
});

describe("request security", () => {
  it("accepts only the exact configured origin", () => {
    const origin = "https://organato.example";
    expect(
      requestMatchesOrigin(
        new Request(`${origin}/api/items`, {
          headers: { Origin: origin },
        }),
        origin,
      ),
    ).toBe(true);
    expect(
      requestMatchesOrigin(
        new Request(`${origin}/api/items`, {
          headers: { Origin: "https://organato.example.attacker.test" },
        }),
        origin,
      ),
    ).toBe(false);
    expect(
      requestMatchesOrigin(
        new Request(`${origin}/api/items`, {
          headers: { Referer: `${origin}/settings/security` },
        }),
        origin,
      ),
    ).toBe(true);
    expect(
      requestMatchesOrigin(new Request(`${origin}/api/items`), origin),
    ).toBe(false);
  });

  it("requires a fresh, non-future authentication timestamp", () => {
    const now = new Date("2026-07-26T10:10:00.000Z");
    expect(hasRecentAuthentication("2026-07-26T10:01:00.000Z", now, 10)).toBe(
      true,
    );
    expect(hasRecentAuthentication("2026-07-26T09:59:59.999Z", now, 10)).toBe(
      false,
    );
    expect(hasRecentAuthentication("2026-07-26T10:10:01.000Z", now, 10)).toBe(
      false,
    );
    expect(hasRecentAuthentication("not-a-date", now, 10)).toBe(false);
  });
});
