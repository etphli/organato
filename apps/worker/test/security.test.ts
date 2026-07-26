import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sha256 } from "../src/security";

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
