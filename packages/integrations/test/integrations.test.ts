import { describe, expect, it } from "vitest";
import { nextLink, validateBaseUrl } from "../src";

describe("Canvas network boundaries", () => {
  it("requires HTTPS", () => {
    expect(() => validateBaseUrl("http://canvas.example.edu")).toThrow(/HTTPS/);
  });

  it("reads the Canvas Link next relation", () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next", <https://canvas.example.edu/api/v1/courses?page=4>; rel="last"';
    expect(nextLink(header)).toContain("page=2");
  });
});
