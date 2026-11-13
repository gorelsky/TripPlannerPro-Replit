import test from "node:test";
import assert from "node:assert/strict";
import { buildTripDataResetPreview } from "./trip-data-reset";

test("reset preview counts only trip, approval and chat rows as deletions", () => {
  const preview = buildTripDataResetPreview({
    trips: 2,
    approvals: 3,
    chatMessages: 4,
    contactMessages: 5,
  });

  assert.deepEqual(preview.deleted, ["trips", "approvals", "chatMessages"]);
  assert.equal(preview.counts.trips + preview.counts.approvals + preview.counts.chatMessages, 9);
  assert.equal(preview.counts.contactMessages, 5);
  assert.ok(preview.preserved.includes("contactMessages"));
  assert.ok(preview.preserved.includes("users"));
  assert.ok(preview.preserved.includes("cities"));
});

test("synthetic reset selection leaves feedback and reference data intact", () => {
  const fixtures = {
    trips: [{ id: "trip-1" }],
    approvals: [{ id: "approval-1" }],
    chatMessages: [{ id: "chat-1" }],
    contactMessages: [{ id: "feedback-1" }],
    users: [{ id: "user-1" }],
    cities: [{ id: "city-1" }],
  };
  const preview = buildTripDataResetPreview({
    trips: fixtures.trips.length,
    approvals: fixtures.approvals.length,
    chatMessages: fixtures.chatMessages.length,
    contactMessages: fixtures.contactMessages.length,
  });
  const deleted = new Set(preview.deleted);
  const afterReset = Object.fromEntries(
    Object.entries(fixtures).map(([table, rows]) => [table, deleted.has(table as any) ? [] : rows]),
  );

  assert.deepEqual(afterReset.contactMessages, fixtures.contactMessages);
  assert.deepEqual(afterReset.users, fixtures.users);
  assert.deepEqual(afterReset.cities, fixtures.cities);
  assert.deepEqual(afterReset.trips, []);
  assert.deepEqual(afterReset.approvals, []);
  assert.deepEqual(afterReset.chatMessages, []);
});
