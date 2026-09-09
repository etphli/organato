import { describe, expect, it } from "vitest";
import {
  runEveningPreview,
  runWeeklyReview,
  sendExamEscalation,
} from "../src/sync";
import type { Env } from "../src/types";

function envWithSettings(settings: Record<string, unknown>) {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            first: async () => ({ settings_json: JSON.stringify(settings) }),
            run: async () => ({ success: true }),
            all: async () => ({ results: [] }),
          };
        },
      };
    },
    async batch() {
      return [];
    },
  };
  return { DB: db } as unknown as Env;
}

describe("evening preview gating", () => {
  it("skips when disabled", async () => {
    const outcome = await runEveningPreview(
      envWithSettings({ eveningPreviewEnabled: false }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "evening_preview_disabled",
    });
  });

  it("skips outside the configured hour", async () => {
    const outcome = await runEveningPreview(
      envWithSettings({ eveningPreviewEnabled: true, eveningHour: 20 }),
      "ws",
      new Date("2026-01-15T08:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "outside_evening_hour",
    });
  });

  it("skips without a Google connection", async () => {
    const outcome = await runEveningPreview(
      envWithSettings({ eveningPreviewEnabled: true, eveningHour: 20 }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "google_not_connected",
    });
  });
});

describe("weekly review gating", () => {
  it("skips when disabled", async () => {
    const outcome = await runWeeklyReview(
      envWithSettings({ weeklyReviewEnabled: false }),
      "ws",
      new Date("2026-01-18T07:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "weekly_review_disabled",
    });
  });

  it("skips outside the Sunday window", async () => {
    const outcome = await runWeeklyReview(
      envWithSettings({ weeklyReviewEnabled: true }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "outside_review_window",
    });
  });
});

describe("exam escalation gating", () => {
  it("skips when disabled", async () => {
    const outcome = await sendExamEscalation(
      envWithSettings({ examEscalationEnabled: false }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "exam_escalation_disabled",
    });
  });

  it("skips without a gateway address", async () => {
    const outcome = await sendExamEscalation(
      envWithSettings({ examEscalationEnabled: true, smsGatewayAddress: "" }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "no_gateway_address",
    });
  });

  it("skips without a Google connection", async () => {
    const outcome = await sendExamEscalation(
      envWithSettings({
        examEscalationEnabled: true,
        smsGatewayAddress: "0400000000@sms.example",
      }),
      "ws",
      new Date("2026-01-15T09:05:00.000Z"),
    );
    expect(outcome).toEqual({
      status: "skipped",
      reason: "google_not_connected",
    });
  });
});
