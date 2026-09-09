import { describe, expect, it } from "vitest";
import { attachmentHref } from "../lib/integrationApi";

describe("attachmentHref", () => {
  it("routes stored files through the authenticated file endpoint", () => {
    expect(attachmentHref({ id: "att-1", url: "kv://ws/item/att-1.pdf" })).toBe(
      "/api/attachments/att-1/file",
    );
  });

  it("leaves external links untouched", () => {
    expect(
      attachmentHref({ id: "att-2", url: "https://example.com/rubric.pdf" }),
    ).toBe("https://example.com/rubric.pdf");
  });
});
