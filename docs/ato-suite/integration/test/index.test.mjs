import test from "node:test";
import assert from "node:assert/strict";
import {
  AtoContractError,
  canonicalId,
  canonicalJson,
  createEventEnvelope,
  idempotencyKey,
  nextRetryDelay,
  parseCanonicalId,
  validateEventEnvelope,
} from "../src/index.mjs";

test("canonical IDs round-trip existing Organato UUIDs", () => {
  const id = canonicalId(
    "organato",
    "item",
    "6a14d912-42bb-4fc3-b4e2-98f55ef8f901",
  );
  assert.equal(id, "ato:organato:item:6a14d912-42bb-4fc3-b4e2-98f55ef8f901");
  assert.deepEqual(parseCanonicalId(id), {
    app: "organato",
    resourceType: "item",
    localId: "6a14d912-42bb-4fc3-b4e2-98f55ef8f901",
  });
});

test("canonical IDs reject ambiguous delimiters", () => {
  assert.throws(
    () => canonicalId("organato", "item", "bad:id"),
    AtoContractError,
  );
});

test("event factory creates a valid deterministic envelope", () => {
  const ids = [
    "123e4567-e89b-42d3-a456-426614174000",
    "123e4567-e89b-42d3-a456-426614174001",
  ];
  const event = createEventEnvelope(
    {
      source: "organato",
      type: "organato.item.updated",
      sequence: 27,
      subject: canonicalId(
        "organato",
        "item",
        "123e4567-e89b-42d3-a456-426614174099",
      ),
      resourceVersion: 4,
      data: { title: "English checkpoint", state: "in_progress" },
    },
    {
      now: () => new Date("2026-07-31T10:15:30.000Z"),
      uuid: () => ids.shift(),
    },
  );
  assert.deepEqual(validateEventEnvelope(event), []);
  assert.equal(event.dataClassification, "personal");
  assert.equal(event.traceId, "123e4567-e89b-42d3-a456-426614174001");
});

test("event validation catches source/subject mismatch and sequence errors", () => {
  const issues = validateEventEnvelope({
    specVersion: "1.0",
    id: "123e4567-e89b-42d3-a456-426614174000",
    source: "emailato",
    type: "emailato.message.updated",
    occurredAt: "2026-07-31T10:15:30.000Z",
    sequence: 0,
    subject: "ato:organato:item:123",
    resourceVersion: 1,
    traceId: "trace-123",
    data: {},
  });
  assert.ok(issues.includes("sequence must be a positive safe integer"));
  assert.ok(issues.includes("subject app must equal source"));
});

test("canonical JSON and idempotency hashes ignore object key insertion order", async () => {
  assert.equal(
    canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"b":2}',
  );
  assert.equal(
    await idempotencyKey("command", { b: 2, a: 1 }),
    await idempotencyKey("command", { a: 1, b: 2 }),
  );
});

test("retry delay is capped exponential backoff with deterministic jitter", () => {
  assert.equal(nextRetryDelay(1, { baseMs: 1_000, jitter: 0 }), 500);
  assert.equal(nextRetryDelay(4, { baseMs: 1_000, jitter: 1 }), 8_000);
  assert.equal(
    nextRetryDelay(30, { baseMs: 1_000, capMs: 60_000, jitter: 1 }),
    60_000,
  );
});
