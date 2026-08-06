import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import {
  getRealtimeRoom,
  getRealtimeRoomLeasesKey,
  getRealtimeRoomMembersKey,
  getRealtimeRoomMetaKey,
  getRealtimeRoomRateKey,
  getRealtimeRoomSequenceKey,
  REALTIME_OUTBOUND_CHANNEL,
  REALTIME_ROOM_MAX_PAYLOAD_BYTES,
  type RealtimeEnvelope,
  type RealtimeRoomDescriptor,
  type RealtimeRoomMember,
} from "@cohub/protocol/realtime";
import { authorizeWorkRoom } from "./api-client.js";
import { redisCommandClient } from "./redis.js";

type RoomConnection = {
  connectionId: string;
  userId?: string;
  token?: string;
  workRooms: Map<string, { participantId: string; ticket: string; room: RealtimeRoomDescriptor }>;
};

type StoredMember = RealtimeRoomMember & { connectionId: string };

export const WORK_ROOM_MAX_PAYLOAD_BYTES = REALTIME_ROOM_MAX_PAYLOAD_BYTES;
export const WORK_ROOM_MAX_EVENT_RATE = 2_000;
export const WORK_ROOM_MEMBER_LEASE_SECONDS = 60;
export const WORK_ROOM_MAX_PENDING_OPS = 256;
export const WORK_ROOM_MAX_PRESENCE_RATE = 30;

export type WorkRoomPresenceRate = { startedAt: number; count: number };

/**
 * Presence writes touch Redis on every call, so they get a connection-level
 * window of their own. Unlike publishes there is no Redis-side rate script,
 * and unlike Board awareness they cannot be dropped silently: the caller is
 * waiting on a request ack, so an over-rate update is rejected instead.
 */
export function consumeWorkRoomPresenceRate(rate: WorkRoomPresenceRate, now = Date.now()): boolean {
  if (now - rate.startedAt >= 1_000) {
    rate.startedAt = now;
    rate.count = 1;
    return true;
  }
  rate.count += 1;
  return rate.count <= WORK_ROOM_MAX_PRESENCE_RATE;
}

/**
 * Drops members whose lease lapsed. Inlined into the scripts that gate on the
 * member set, because a capacity or authorization check is only sound if the
 * sweep happens in the same atomic call. Expects KEYS[2]=members, KEYS[3]=leases
 * and a local `now` in milliseconds.
 */
const SWEEP_EXPIRED_LEASES = `for _, participantId in ipairs(redis.call("zrangebyscore", KEYS[3], "-inf", now)) do
  redis.call("zrem", KEYS[3], participantId)
  redis.call("hdel", KEYS[2], participantId)
end`;

const JOIN_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return {-1} end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return {-2} end
${SWEEP_EXPIRED_LEASES}
local participantId = ARGV[1]
-- seatPerUser: reuse the seat this viewer already holds instead of consuming
-- another. Expired leases were swept above, so only live seats match.
if meta.seatPerUser then
  for _, existingId in ipairs(redis.call("zrange", KEYS[3], 0, -1)) do
    local existingRaw = redis.call("hget", KEYS[2], existingId)
    if existingRaw then
      local existing = cjson.decode(existingRaw)
      if existing.userKey == ARGV[5] then
        participantId = existingId
        break
      end
    end
  end
end
local current = redis.call("hget", KEYS[2], participantId)
if not current and redis.call("zcard", KEYS[3]) >= tonumber(meta.maxParticipants) then return {-3} end
local member
local isNew = 0
if current then
  member = cjson.decode(current)
else
  isNew = 1
  member = { participantId = participantId, joinedAt = ARGV[4], presence = cjson.null }
end
member.userKey = ARGV[5]
member.connectionId = ARGV[2]
redis.call("hset", KEYS[2], participantId, cjson.encode(member))
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, participantId)
redis.call("pexpireat", KEYS[2], math.floor(tonumber(meta.expiresAtMs)))
redis.call("pexpireat", KEYS[3], math.floor(tonumber(meta.expiresAtMs)))
member.connectionId = nil
return {1, isNew, cjson.encode(member)}
`;

// Read-only member snapshot plus the current sequence, taken as one cut. Run after the
// connection is subscribed so the sequence is a baseline the event stream extends: a
// client drops buffered deltas at or below it and applies the rest.
const SNAPSHOT_ROOM_SCRIPT = `
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local members = {}
for _, participantId in ipairs(redis.call("zrangebyscore", KEYS[2], now, "+inf")) do
  local raw = redis.call("hget", KEYS[1], participantId)
  if raw then
    local item = cjson.decode(raw)
    item.connectionId = nil
    table.insert(members, item)
  end
end
local sequence = tonumber(redis.call("get", KEYS[3])) or 0
return {cjson.encode(members), sequence}
`;

const LEAVE_ROOM_SCRIPT = `
local raw = redis.call("hget", KEYS[1], ARGV[1])
if not raw then return 0 end
local member = cjson.decode(raw)
if member.connectionId ~= ARGV[2] then return -1 end
redis.call("hdel", KEYS[1], ARGV[1])
redis.call("zrem", KEYS[2], ARGV[1])
member.connectionId = nil
return cjson.encode(member)
`;

const RENEW_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -1 end
local member = cjson.decode(raw)
-- Seat taken over by a newer connection: the participant is still present.
if member.connectionId ~= ARGV[2] then return -5 end
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, ARGV[1])
return 1
`;

const PRESENCE_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -3 end
local member = cjson.decode(raw)
-- Seat taken over by a newer connection: the participant is still present.
if member.connectionId ~= ARGV[2] then return -5 end
member.presence = cjson.decode(ARGV[4])
redis.call("hset", KEYS[2], ARGV[1], cjson.encode(member))
local leaseUntil = math.min(now + tonumber(ARGV[3]) * 1000, tonumber(meta.expiresAtMs))
redis.call("zadd", KEYS[3], leaseUntil, ARGV[1])
return cjson.encode(member)
`;

const PUBLISH_ROOM_SCRIPT = `
local metaRaw = redis.call("get", KEYS[1])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
${SWEEP_EXPIRED_LEASES}
local raw = redis.call("hget", KEYS[2], ARGV[1])
if not raw then return -3 end
local member = cjson.decode(raw)
-- Seat taken over by a newer connection: the participant is still present.
if member.connectionId ~= ARGV[2] then return -5 end
local second = tostring(math.floor(now / 1000))
local count = redis.call("hincrby", KEYS[5], second, 1)
redis.call("expire", KEYS[5], 2)
if count > tonumber(ARGV[8]) then return -4 end
local sequence = redis.call("incr", KEYS[4])
redis.call("pexpireat", KEYS[4], math.floor(tonumber(meta.expiresAtMs)))
local clientEventId = cjson.null
if ARGV[9] ~= "" then clientEventId = ARGV[9] end
local envelope = {
  id = ARGV[3],
  timestamp = now,
  domain = "room",
  type = "realtime.room.event",
  rooms = { ARGV[7] },
  payload = {
    roomId = ARGV[6],
    sequence = sequence,
    event = ARGV[4],
    data = cjson.decode(ARGV[5]),
    clientEventId = clientEventId,
    sender = { participantId = ARGV[1] }
  }
}
redis.call("publish", ARGV[10], cjson.encode(envelope))
return sequence
`;

const CONTROL_EVENT_SCRIPT = `
local metaRaw = redis.call("get", KEYS[2])
if not metaRaw then return -1 end
local meta = cjson.decode(metaRaw)
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
if tonumber(meta.expiresAtMs) <= now then return -2 end
local sequence = redis.call("incr", KEYS[1])
redis.call("pexpireat", KEYS[1], math.floor(tonumber(meta.expiresAtMs)))
local envelope = cjson.decode(ARGV[1])
envelope.timestamp = now
envelope.payload.sequence = sequence
redis.call("publish", ARGV[2], cjson.encode(envelope))
return sequence
`;

const toStoredMember = (raw: string): RealtimeRoomMember | null => {
  try {
    const value = JSON.parse(raw) as Partial<StoredMember>;
    if (typeof value.participantId !== "string" || typeof value.joinedAt !== "string") return null;
    return {
      participantId: value.participantId,
      joinedAt: value.joinedAt,
      presence: value.presence && typeof value.presence === "object" && !Array.isArray(value.presence)
        ? value.presence as Record<string, unknown>
        : null,
      ...(typeof value.userKey === "string" ? { userKey: value.userKey } : {}),
    };
  } catch {
    return null;
  }
};

const roomKeys = (roomId: string): [string, string, string, string, string] => [
  getRealtimeRoomMetaKey(roomId),
  getRealtimeRoomMembersKey(roomId),
  getRealtimeRoomLeasesKey(roomId),
  getRealtimeRoomSequenceKey(roomId),
  getRealtimeRoomRateKey(roomId),
];

export type WorkRoomMembershipStatus = "active" | "expired" | "revoked" | "superseded";

/**
 * Raised when an operation proves the membership is gone. Connection state is left
 * alone so the Gateway can own teardown in one place.
 */
export class WorkRoomMembershipLostError extends Error {
  constructor(message: string, readonly status: Exclude<WorkRoomMembershipStatus, "active">) {
    super(message);
    this.name = "WorkRoomMembershipLostError";
  }
}

/** Script status codes that mean this connection no longer holds its seat. */
const MEMBERSHIP_LOST_CODES: Record<number, { message: string; status: Exclude<WorkRoomMembershipStatus, "active"> }> = {
  [-1]: { message: "room not found", status: "revoked" },
  [-2]: { message: "room expired", status: "expired" },
  [-3]: { message: "room membership is stale", status: "revoked" },
  [-5]: { message: "room membership is stale", status: "superseded" },
};

/** For operations that hold a seat, where losing it is the interesting outcome. */
const membershipError = (code: number) => {
  const lost = MEMBERSHIP_LOST_CODES[code];
  if (lost) return new WorkRoomMembershipLostError(lost.message, lost.status);
  if (code === -4) return new Error("room event rate exceeded");
  return new Error("room request failed");
};

/** Join has no seat to lose yet, and -3 means the room is full rather than stale. */
const joinError = (code: number) => {
  if (code === -1) return new Error("room not found");
  if (code === -2) return new Error("room expired");
  if (code === -3) return new Error("room is full");
  return new Error("room request failed");
};

/** Authorizes a join with no side effect, so the caller can order the steps that follow. */
export async function authorizeWorkRoomJoin(ctx: RoomConnection, input: { roomId: string; ticket: string }) {
  if (!ctx.token || !ctx.userId) throw new Error("authentication required");
  return authorizeWorkRoom({ authToken: ctx.token, roomId: input.roomId, ticket: input.ticket });
}

/**
 * Claims the seat only. The caller subscribes to the room next and then reads the
 * snapshot with {@link readWorkRoomSnapshot}: an unseated connection must never enter
 * the public routing table, yet the snapshot must be taken after subscribing so no
 * event slips through the gap between the two.
 */
export async function claimWorkRoomSeat(
  ctx: RoomConnection,
  input: { roomId: string; ticket: string; admission: Awaited<ReturnType<typeof authorizeWorkRoomJoin>> },
  redis: Redis = redisCommandClient,
) {
  const { admission } = input;
  const [metaKey, membersKey, leasesKey] = roomKeys(input.roomId);
  const result = await redis.eval(
    JOIN_ROOM_SCRIPT,
    3,
    metaKey,
    membersKey,
    leasesKey,
    admission.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
    new Date().toISOString(),
    admission.userKey,
  ) as [number, number?, string?];
  const code = Number(result[0]);
  if (code !== 1) throw joinError(code);
  const member = toStoredMember(result[2] ?? "{}");
  if (!member) throw new Error("invalid room member");
  // seatPerUser may hand back an existing seat, so the stored member wins.
  const participantId = member.participantId;
  ctx.workRooms.set(input.roomId, { participantId, ticket: input.ticket, room: admission.room });
  return { ...admission, participantId, member, isNew: Number(result[1]) === 1 };
}

/** Atomic member snapshot and baseline sequence, read after the caller subscribed. */
export async function readWorkRoomSnapshot(roomId: string, redis: Redis = redisCommandClient) {
  const [, membersKey, leasesKey, sequenceKey] = roomKeys(roomId);
  const result = await redis.eval(SNAPSHOT_ROOM_SCRIPT, 3, membersKey, leasesKey, sequenceKey) as [string?, number?];
  const members = JSON.parse(result[0] ?? "[]") as RealtimeRoomMember[];
  return { members, sequence: Number(result[1] ?? 0) };
}

export async function leaveWorkRoom(ctx: RoomConnection, roomId: string, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) return null;
  const result = await redis.eval(
    LEAVE_ROOM_SCRIPT,
    2,
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
  );
  ctx.workRooms.delete(roomId);
  return typeof result === "string" ? toStoredMember(result) : null;
}

// Atomically claim expired leases so exactly one connection announces each
// removal, even when several are sweeping the same room concurrently.
const SWEEP_LEASES_SCRIPT = `
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call("zrangebyscore", KEYS[2], "-inf", now)
local removed = {}
for _, participantId in ipairs(expired) do
  if redis.call("zrem", KEYS[2], participantId) == 1 then
    redis.call("hdel", KEYS[1], participantId)
    table.insert(removed, participantId)
  end
end
return removed
`;

/**
 * Drops members whose lease lapsed and announces them.
 *
 * The other room scripts sweep expired leases inline, but they cannot announce
 * the removal, so peers would keep a ghost member until they rejoined. This
 * runs from the ping path, which means a room recovers even when the gateway
 * that held the member crashed without running its close handler.
 */
export async function sweepWorkRoomLeases(roomId: string, redis: Redis = redisCommandClient) {
  const result = await redis.eval(
    SWEEP_LEASES_SCRIPT,
    2,
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
  );
  const removed = Array.isArray(result) ? result.filter((value): value is string => typeof value === "string") : [];
  for (const participantId of removed) {
    // A room that expired outright has no audience left, so a failed announce
    // is not worth surfacing to the caller.
    await publishWorkRoomControlEvent({
      roomId,
      type: "realtime.room.member.left",
      payload: { roomId, member: { participantId } },
    }, redis).catch(() => undefined);
  }
  return removed;
}

export async function renewWorkRoomMembership(ctx: RoomConnection, roomId: string, redis: Redis = redisCommandClient): Promise<WorkRoomMembershipStatus> {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) return "revoked";
  const result = await redis.eval(
    RENEW_ROOM_SCRIPT,
    3,
    getRealtimeRoomMetaKey(roomId),
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
  );
  const code = Number(result);
  if (code === 1) return "active";
  if (code === -2) return "expired";
  return code === -5 ? "superseded" : "revoked";
}

export async function updateWorkRoomPresence(ctx: RoomConnection, roomId: string, presence: Record<string, unknown> | null, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(roomId);
  if (!membership) throw new Error("room membership is required");
  const result = await redis.eval(
    PRESENCE_ROOM_SCRIPT,
    3,
    getRealtimeRoomMetaKey(roomId),
    getRealtimeRoomMembersKey(roomId),
    getRealtimeRoomLeasesKey(roomId),
    membership.participantId,
    ctx.connectionId,
    String(WORK_ROOM_MEMBER_LEASE_SECONDS),
    JSON.stringify(presence),
  );
  // No local cleanup: the Gateway owns teardown, which a bare map delete would skip.
  if (typeof result !== "string") throw membershipError(Number(result));
  const member = toStoredMember(result);
  if (!member) throw new Error("invalid room member");
  return member;
}

export async function publishWorkRoomEvent(ctx: RoomConnection, input: {
  roomId: string;
  event: string;
  data: unknown;
  clientEventId?: string;
}, redis: Redis = redisCommandClient) {
  const membership = ctx.workRooms.get(input.roomId);
  if (!membership) throw new Error("room membership is required");
  if (input.event.toLowerCase().startsWith("cohub.")) throw new Error("reserved room event name");
  const dataJson = JSON.stringify(input.data);
  if (dataJson === undefined || Buffer.byteLength(dataJson, "utf8") > WORK_ROOM_MAX_PAYLOAD_BYTES) {
    throw new Error("room event payload is too large");
  }
  const eventId = randomUUID();
  const [metaKey, membersKey, leasesKey, sequenceKey, rateKey] = roomKeys(input.roomId);
  const result = await redis.eval(
    PUBLISH_ROOM_SCRIPT,
    5,
    metaKey,
    membersKey,
    leasesKey,
    sequenceKey,
    rateKey,
    membership.participantId,
    ctx.connectionId,
    eventId,
    input.event,
    dataJson,
    input.roomId,
    getRealtimeRoom(input.roomId),
    String(WORK_ROOM_MAX_EVENT_RATE),
    input.clientEventId ?? "",
    REALTIME_OUTBOUND_CHANNEL,
  );
  const sequence = Number(result);
  if (sequence < 0) throw membershipError(sequence);
  return { eventId, sequence, clientEventId: input.clientEventId ?? null };
}

export async function publishWorkRoomControlEvent(input: {
  roomId: string;
  type: string;
  payload: Record<string, unknown>;
}, redis: Redis = redisCommandClient) {
  const envelope: RealtimeEnvelope = {
    id: randomUUID(),
    timestamp: Date.now(),
    domain: "room",
    type: input.type,
    rooms: [getRealtimeRoom(input.roomId)],
    payload: input.payload,
  };
  const result = await redis.eval(
    CONTROL_EVENT_SCRIPT,
    2,
    getRealtimeRoomSequenceKey(input.roomId),
    getRealtimeRoomMetaKey(input.roomId),
    JSON.stringify(envelope),
    REALTIME_OUTBOUND_CHANNEL,
  );
  const sequence = Number(result);
  if (sequence < 0) throw membershipError(sequence);
  return sequence;
}
