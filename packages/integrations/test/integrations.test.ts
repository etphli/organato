import { describe, expect, it } from "vitest";
import {
  CanvasConnectionError,
  CanvasRestProvider,
  nextLink,
  validateBaseUrl,
} from "../src";

describe("Canvas network boundaries", () => {
  it("requires HTTPS", () => {
    expect(() => validateBaseUrl("http://canvas.example.edu")).toThrow(/HTTPS/);
  });

  it("canonicalizes Canvas links to one origin", () => {
    expect(
      validateBaseUrl(
        "https://EMANUEL.instructure.com/courses/42?module=work#today",
      ).href,
    ).toBe("https://emanuel.instructure.com/");
  });

  it("rejects credentials embedded in a Canvas address", () => {
    expect(() =>
      validateBaseUrl("https://token@emanuel.instructure.com"),
    ).toThrow(/credentials/);
  });

  it("reads the Canvas Link next relation", () => {
    const header =
      '<https://canvas.example.edu/api/v1/courses?page=2>; rel="next", <https://canvas.example.edu/api/v1/courses?page=4>; rel="last"';
    expect(nextLink(header)).toContain("page=2");
  });

  it("never follows pagination to another origin", async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify([
          { id: 1, name: "English", workflow_state: "available" },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://attacker.example/api/v1/courses?page=2>; rel="next"',
          },
        },
      )) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).rejects.toMatchObject({
      name: "CanvasConnectionError",
      code: "unexpected_origin",
    } satisfies Partial<CanvasConnectionError>);
  });

  it("treats another port as another origin", async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify([
          { id: 1, name: "English", workflow_state: "available" },
        ]),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://emanuel.instructure.com:8443/api/v1/courses?page=2>; rel="next"',
          },
        },
      )) as typeof fetch;
    const provider = new CanvasRestProvider(
      "https://emanuel.instructure.com",
      "private-token",
      fetcher,
    );

    await expect(provider.fetchUpcomingAssignments()).rejects.toMatchObject({
      code: "unexpected_origin",
    });
  });
});
