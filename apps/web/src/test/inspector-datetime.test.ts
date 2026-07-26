import { describe, expect, it } from "vitest";
import { dueInputValues, duePatchFromInputs } from "../components/Inspector";

describe("Inspector due editing", () => {
  it("shows UTC instants in the workspace timezone", () => {
    expect(
      dueInputValues(
        {
          dueAt: "2026-07-27T06:00:00.000Z",
          dueDateLocal: null,
          dueHasExplicitTime: true,
        },
        "Australia/Sydney",
      ),
    ).toEqual({ date: "2026-07-27", time: "16:00" });
  });

  it("keeps date-only items date-only", () => {
    expect(
      dueInputValues(
        {
          dueAt: null,
          dueDateLocal: "2026-07-30",
          dueHasExplicitTime: false,
        },
        "Australia/Sydney",
      ),
    ).toEqual({ date: "2026-07-30", time: "" });
    expect(duePatchFromInputs("2026-07-30", "", "Australia/Sydney")).toEqual({
      dueAt: null,
      dueDateLocal: "2026-07-30",
      dueHasExplicitTime: false,
    });
  });

  it("clears the local date when an explicit time is added", () => {
    expect(
      duePatchFromInputs("2026-07-30", "16:00", "Australia/Sydney"),
    ).toEqual({
      dueAt: "2026-07-30T06:00:00.000Z",
      dueDateLocal: null,
      dueHasExplicitTime: true,
    });
  });

  it("clears every due field when the date is removed", () => {
    expect(duePatchFromInputs("", "16:00", "Australia/Sydney")).toEqual({
      dueAt: null,
      dueDateLocal: null,
      dueHasExplicitTime: false,
    });
  });
});
