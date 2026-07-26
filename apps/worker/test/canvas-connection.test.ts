import { CanvasConnectionError } from "@organato/integrations";
import { describe, expect, it } from "vitest";
import {
  canvasConnectSchema,
  configuredCanvasInstallation,
  createCanvasConnectionMetadata,
  nextHourlySyncAt,
  parseCanvasConnectionMetadata,
  safeCanvasConnectionError,
} from "../src/canvas-connection";

describe("Canvas connection boundary", () => {
  it("accepts only a token from the browser", () => {
    expect(
      canvasConnectSchema.safeParse({ token: "a-secure-token-value" }).success,
    ).toBe(true);
    expect(
      canvasConnectSchema.safeParse({
        token: "a-secure-token-value",
        baseUrl: "https://attacker.example",
      }).success,
    ).toBe(false);
  });

  it("uses the deployment-pinned installation", () => {
    const installation = configuredCanvasInstallation({
      CANVAS_BASE_URL:
        "https://EMANUEL.instructure.com/courses/42?from=settings",
      CANVAS_DISPLAY_NAME: "Emanuel School Canvas",
    });
    expect(installation.baseUrl.origin).toBe("https://emanuel.instructure.com");
    expect(installation.name).toBe("Emanuel School Canvas");
  });

  it("fails closed when a placeholder installation is deployed", () => {
    expect(() =>
      configuredCanvasInstallation({
        CANVAS_BASE_URL: "https://canvas.example.edu",
      }),
    ).toThrow("canvas_installation_not_configured");
  });

  it("stores canonical, secret-free metadata", () => {
    const metadata = createCanvasConnectionMetadata({
      baseUrl: new URL("https://emanuel.instructure.com/"),
      userId: "canvas-owner",
      userName: "Ethan Likht",
      now: "2026-07-26T10:00:00.000Z",
    });
    expect(metadata.baseUrl).toBe("https://emanuel.instructure.com");
    expect(metadata.credentialAad).toBe(
      "integration:canvas:https://emanuel.instructure.com",
    );
    expect(JSON.stringify(metadata)).not.toContain("private-token");
    expect(parseCanvasConnectionMetadata(JSON.stringify(metadata))).toEqual(
      metadata,
    );
  });

  it("gives token rejection a safe, useful message", () => {
    expect(
      safeCanvasConnectionError(
        new CanvasConnectionError("token_rejected", "raw provider error"),
      ),
    ).toMatch(/token was not accepted/i);
  });

  it("calculates the next top-of-hour check", () => {
    expect(nextHourlySyncAt(new Date("2026-07-26T10:42:51.000Z"))).toBe(
      "2026-07-26T11:00:00.000Z",
    );
  });
});
