import { describe, expect, it } from "vitest";
import { workspaceCacheSchema } from "@organato/domain/backup";
import { seedItems, seedSettings, seedSubjects, seedViews } from "../data/seed";

const snapshot = {
  version: 1,
  exportedAt: new Date().toISOString(),
  settings: seedSettings,
  subjects: seedSubjects,
  savedViews: seedViews,
  items: [
    {
      ...seedItems[0],
      links: {
        blockedBy: [{ itemId: "dependency", linkId: "link-one" }],
        blocking: [],
      },
    },
  ],
};

describe("workspace cache schema", () => {
  it("preserves dependency link identities when validating saved data", () => {
    const result = workspaceCacheSchema.safeParse(snapshot);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.items[0]?.links.blockedBy).toEqual([
        { itemId: "dependency", linkId: "link-one" },
      ]);
  });
  it("rejects corrupt fields, unsafe URLs, and unsupported snapshot versions", () => {
    for (const value of [
      { ...snapshot, version: 2 },
      { ...snapshot, items: [{ ...snapshot.items[0], displayName: {} }] },
      {
        ...snapshot,
        items: [{ ...snapshot.items[0], canvasHtmlUrl: "javascript:alert(1)" }],
      },
      {
        ...snapshot,
        items: [
          {
            ...snapshot.items[0],
            links: { blockedBy: ["dependency"], blocking: [] },
          },
        ],
      },
    ])
      expect(workspaceCacheSchema.safeParse(value).success).toBe(false);
  });
});
