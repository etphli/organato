import { describe, expect, it } from "vitest";
import {
  createStudatoFeedRoutes,
  projectStudatoSources,
} from "../src/studato-feed";
import type { Env } from "../src/types";

const item = {
  id: "assignment-1",
  version: 4,
  kind: "work",
  classification: "assignment",
  displayName: "Private assessment title",
  subjectId: "maths",
  workingStatus: "in_progress",
  priority: "high",
  dueAt: "2026-08-28T09:00:00+10:00",
  dueDateLocal: null,
  updatedAt: "2026-08-23T11:00:00+10:00",
  notesMarkdown: "must never leave Organato",
  canvasAssignmentId: "private-provider-id",
  attachments: [{ id: "private-attachment" }],
  history: [{ id: "private-history" }],
} as never;

describe("Studato assignment metadata feed", () => {
  it("projects only the approved assignment fields", () => {
    const [projection] = projectStudatoSources(
      [item],
      [{ id: "maths", displayName: "Mathematics" } as never],
    );
    expect(projection).toMatchObject({
      canonicalId: "ato:organato:item:assignment-1",
      sourceVersion: 4,
      title: "Private assessment title",
      subject: { label: "Mathematics" },
      classification: "assignment",
      deepLink: "/assignments",
      dataClassification: "metadata",
    });
    expect(JSON.stringify(projection)).not.toContain("notesMarkdown");
    expect(JSON.stringify(projection)).not.toContain("canvasAssignmentId");
    expect(JSON.stringify(projection)).not.toContain("attachment");
    expect(JSON.stringify(projection)).not.toContain("history");
  });

  it("requires a signed token and keeps the feed user scoped", async () => {
    const routes = createStudatoFeedRoutes({
      verify: async (token) => {
        if (token !== "valid-token") throw new Error("invalid");
        return { email: "owner@example.com", subject: "studato-user" };
      },
      load: async (_env, identity) =>
        identity.email === "owner@example.com"
          ? {
              items: [item],
              subjects: [{ id: "maths", displayName: "Mathematics" } as never],
            }
          : null,
    });
    const env = {} as Env;

    expect((await routes.request("/feeds/study-sources", {}, env)).status).toBe(
      401,
    );
    const response = await routes.request(
      "/feeds/study-sources",
      { headers: { Authorization: "Bearer valid-token" } },
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{ canonicalId: string }>;
    };
    expect(body.items.map((source) => source.canonicalId)).toEqual([
      "ato:organato:item:assignment-1",
    ]);
  });
});
