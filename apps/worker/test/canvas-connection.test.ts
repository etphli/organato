import { CanvasConnectionError } from "@organato/integrations";
import { describe, expect, it } from "vitest";
import {
  canvasConnectSchema,
  configuredCanvasInstallation,
  createCanvasConnectionMetadata,
  nextHourlySyncAt,
  parseCanvasConnectionMetadata,
  safeCanvasConnectionError,
  canvasConnectionErrorCode,
} from "../src/canvas-connection";

describe("Canvas connection boundary", () => {
  it("accepts only a session cookie from the browser", () => {
    expect(
      canvasConnectSchema.safeParse({
        cookie: "canvas_session=a-secure-session-value",
      }).success,
    ).toBe(true);
    expect(
      canvasConnectSchema.parse({
        cookie: '  cookie: "canvas_session=a-secure-session-value"\n',
      }),
    ).toEqual({ cookie: "canvas_session=a-secure-session-value" });
    expect(
      canvasConnectSchema.safeParse({
        cookie: "canvas_session=a-secure-session-value",
        baseUrl: "https://attacker.example",
      }).success,
    ).toBe(false);
  });

  it("rejects a cookie value with line breaks or control characters", () => {
    expect(
      canvasConnectSchema.safeParse({
        cookie: "canvas_session=one\ncanvas_session=two",
      }).success,
    ).toBe(false);
    expect(
      canvasConnectSchema.safeParse({ cookie: "canvas_session=\u0007" })
        .success,
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
    expect(JSON.stringify(metadata)).not.toContain("private-session");
    expect(parseCanvasConnectionMetadata(JSON.stringify(metadata))).toEqual(
      metadata,
    );
  });

  it("gives session rejection a safe, useful message", () => {
    expect(
      safeCanvasConnectionError(
        new CanvasConnectionError("session_rejected", "raw provider error"),
      ),
    ).toMatch(/ended this browser session/i);
  });

  it("does not tell a user to regenerate a token when Canvas denied API access", () => {
    const error = new CanvasConnectionError(
      "api_access_denied",
      "raw provider error",
      403,
    );

    expect(safeCanvasConnectionError(error)).toMatch(
      /GET \/api\/v1\/courses.*assignments/i,
    );
    expect(canvasConnectionErrorCode(error)).toBe("api_access_denied");
  });

  it("calculates the next top-of-hour check", () => {
    expect(nextHourlySyncAt(new Date("2026-07-26T10:42:51.000Z"))).toBe(
      "2026-07-26T11:00:00.000Z",
    );
  });
});
