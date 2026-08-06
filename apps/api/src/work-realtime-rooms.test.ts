import assert from "node:assert/strict";
import test from "node:test";
import type { Redis } from "ioredis";
import {
  WORK_ROOM_MAX_ACTIVE_PER_WORK,
  WORK_ROOM_MAX_EXPIRES_IN_SECONDS,
  WORK_ROOM_MAX_PARTICIPANTS,
  WorkRoomError,
  createWorkRoom,
  deriveWorkRoomUserKey,
  normalizeWorkRoomCode,
  normalizeWorkRoomOptions,
} from "./work-realtime-rooms.js";

test("normalizes Work room codes without making them case-sensitive", () => {
  assert.equal(normalizeWorkRoomCode("  team-alpha "), "TEAM-ALPHA");
  assert.equal(normalizeWorkRoomCode("a_b2"), "A_B2");
  assert.equal(normalizeWorkRoomCode("a"), null);
  assert.equal(normalizeWorkRoomCode("room name"), null);
});

test("validates the absolute room lifetime and capacity limits", () => {
  assert.deepEqual(
    normalizeWorkRoomOptions({ code: "demo", expiresInSeconds: 3_600, maxParticipants: 64 }),
    { code: "DEMO", expiresInSeconds: 3_600, maxParticipants: 64, seatPerUser: false },
  );
  // Per connection unless the room opts in, so two tabs stay two participants.
  assert.equal(normalizeWorkRoomOptions({ seatPerUser: true }).seatPerUser, true);
  assert.throws(() => normalizeWorkRoomOptions({ seatPerUser: "yes" }), /seatPerUser/);
  assert.throws(
    () => normalizeWorkRoomOptions({ expiresInSeconds: WORK_ROOM_MAX_EXPIRES_IN_SECONDS + 1 }),
    /expiresInSeconds/,
  );
  assert.throws(
    () => normalizeWorkRoomOptions({ maxParticipants: WORK_ROOM_MAX_PARTICIPANTS + 1 }),
    /maxParticipants/,
  );
});

const evalStub = (results: number[]) => {
  const calls: unknown[][] = [];
  const redis = {
    eval: async (...args: unknown[]) => {
      calls.push(args);
      return results[calls.length - 1] ?? 0;
    },
  } as unknown as Redis;
  return { redis, calls };
};

test("surfaces the per-Work active room quota instead of retrying codes", async () => {
  const { redis, calls } = evalStub([-1]);
  await assert.rejects(
    () => createWorkRoom({ workId: "work-1", redis }),
    (error: unknown) => {
      assert.ok(error instanceof WorkRoomError);
      assert.equal(error.code, "ROOM_QUOTA_EXCEEDED");
      assert.match(error.message, new RegExp(String(WORK_ROOM_MAX_ACTIVE_PER_WORK)));
      return true;
    },
  );
  assert.equal(calls.length, 1, "quota rejection must not burn code-allocation retries");
});

test("passes the quota limit, room index key and millisecond expiry into the create script", async () => {
  const { redis, calls } = evalStub([1]);
  const room = await createWorkRoom({ workId: "work-1", code: "demo", redis });
  assert.equal(room.code, "DEMO");
  const [, keyCount, , , indexKey, roomId, , expiresAt, quota] = calls[0] as [string, number, string, string, string, string, string, string, string];
  assert.equal(keyCount, 3);
  assert.equal(indexKey, "cohub:realtime-room:v1:work:work-1:rooms");
  assert.equal(roomId, room.id);
  assert.equal(quota, String(WORK_ROOM_MAX_ACTIVE_PER_WORK));
  // PXAT millisecond precision keeps a natural expiry distinguishable from a
  // vanished room, so the value must not be truncated to whole seconds.
  assert.equal(expiresAt, String(Date.parse(room.expiresAt)));
});

test("derives a user key that is stable per viewer and scoped to one room", () => {
  const secret = "test-work-room-key";
  const roomA = "00000000-0000-4000-8000-000000000001";
  const roomB = "00000000-0000-4000-8000-000000000002";
  const key = deriveWorkRoomUserKey(roomA, "user-1", secret);

  // Every connection of the same viewer must agree, so a seatPerUser room can
  // recognise a seat the viewer already holds.
  assert.equal(deriveWorkRoomUserKey(roomA, "user-1", secret), key);
  assert.notEqual(deriveWorkRoomUserKey(roomA, "user-2", secret), key);
  assert.notEqual(deriveWorkRoomUserKey(roomB, "user-1", secret), key);
  // Stays opaque: it is keyed material, not the raw user uuid.
  assert.doesNotMatch(key, /user-1/);
});
