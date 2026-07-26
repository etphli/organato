import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src";

describe("email rendering", () => {
  it("escapes imported text", () => {
    expect(escapeHtml('<script>alert("x")</script>')).not.toContain("<script>");
  });
});
