import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";
import {
  getRealtimeRoomCodeKey,
  getRealtimeRoomIndexKey,
  getRealtimeRoomMetaKey,
  type RealtimeRoomDescriptor,
} from "@cohub/protocol/realtime";
import { config } from "./config.js";

export const WORK_ROOM_DEFAULT_EXPIRES_IN_SECONDS = 2 * 60 * 60;
export const WORK_ROOM_MAX_EXPIRES_IN_SECONDS = 24 * 60 * 60;
export const WORK_ROOM_MIN_EXPIRES_IN_SECONDS = 60;
export const WORK_ROOM_DEFAULT_MAX_PARTICIPANTS = 16;
export const WORK_ROOM_MAX_PARTICIPANTS = 128;
export const WORK_ROOM_CODE_MAX_LENGTH = 48;
export const WORK_ROOM_CODE_MIN_LENGTH = 3;
export const WORK_ROOM_MAX_ACTIVE_PER_WORK = 512;

const ROOM_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,47}$/;
// KEYS: code, meta, per-work room index. The index is a sorted set scored by
// expiresAtMs so expired rooms are swept here instead of needing a separate GC.
// Meta uses PXAT so it survives until the exact logical expiry: truncating to
// whole seconds would drop it early and make a natural expiry look like a
// vanished room, which readers report as revoked rather than expired.
const CREATE_ROOM_SCRIPT = `
local time = redis.call("time")
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call("zremrangebyscore", KEYS[3], "-inf", now)
if redis.call("zcard", KEYS[3]) >= tonumber(ARGV[4]) then return -1 end
if redis.call("exists", KEYS[1]) == 1 then return 0 end
redis.call("set", KEYS[1], ARGV[1], "PXAT", ARGV[3])
redis.call("set", KEYS[2], ARGV[2], "PXAT", ARGV[3])
redis.call("zadd", KEYS[3], ARGV[3], ARGV[1])
-- Keep the index alive until its longest-lived room expires.
local newest = redis.call("zrange", KEYS[3], -1, -1, "WITHSCORES")
redis.call("pexpireat", KEYS[3], math.floor(tonumber(newest[2])))
return 1
`;

export type WorkRoomRecord = RealtimeRoomDescriptor & { workId: string; expiresAtMs: number };

export class WorkRoomError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_CODE"
      | "INVALID_TTL"
      | "INVALID_CAPACITY"
      | "ROOM_CODE_TAKEN"
      | "ROOM_QUOTA_EXCEEDED"
      | "ROOM_NOT_FOUND"
      | "ROOM_EXPIRED",
  ) {
    super(message);
    this.name = "WorkRoomError";
  }
}

export const normalizeWorkRoomCode = (value: unknown) => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
};

export const normalizeWorkRoomOptions = (input: {
  code?: unknown;
  expiresInSeconds?: unknown;
  maxParticipants?: unknown;
  seatPerUser?: unknown;
}) => {
  const code = input.code === undefined ? null : normalizeWorkRoomCode(input.code);
  if (input.code !== undefined && !code) {
    throw new WorkRoomError("room code must be 3-48 ASCII characters", "INVALID_CODE");
  }

  const expiresInSeconds = input.expiresInSeconds === undefined
    ? WORK_ROOM_DEFAULT_EXPIRES_IN_SECONDS
    : Number(input.expiresInSeconds);
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < WORK_ROOM_MIN_EXPIRES_IN_SECONDS || expiresInSeconds > WORK_ROOM_MAX_EXPIRES_IN_SECONDS) {
    throw new WorkRoomError(
      `expiresInSeconds must be between ${WORK_ROOM_MIN_EXPIRES_IN_SECONDS} and ${WORK_ROOM_MAX_EXPIRES_IN_SECONDS}`,
      "INVALID_TTL",
    );
  }

  const maxParticipants = input.maxParticipants === undefined
    ? WORK_ROOM_DEFAULT_MAX_PARTICIPANTS
    : Number(input.maxParticipants);
  if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > WORK_ROOM_MAX_PARTICIPANTS) {
    throw new WorkRoomError(
      "maxParticipants must be between 2 and 128",
      "INVALID_CAPACITY",
    );
  }

  if (input.seatPerUser !== undefined && typeof input.seatPerUser !== "boolean") {
    throw new WorkRoomError("seatPerUser must be a boolean", "INVALID_CAPACITY");
  }

  return { code, expiresInSeconds, maxParticipants, seatPerUser: input.seatPerUser === true };
};

export const serializeWorkRoom = (value: WorkRoomRecord): RealtimeRoomDescriptor => ({
  id: value.id,
  code: value.code,
  createdAt: value.createdAt,
  expiresAt: value.expiresAt,
  maxParticipants: value.maxParticipants,
  seatPerUser: value.seatPerUser,
});

const readRoom = (raw: string | null): WorkRoomRecord | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkRoomRecord>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.workId !== "string" ||
      typeof parsed.expiresAtMs !== "number" ||
      typeof parsed.code !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.maxParticipants !== "number"
    ) return null;
    // Rooms created before seatPerUser existed keep the per-connection default.
    return { ...parsed, seatPerUser: parsed.seatPerUser === true } as WorkRoomRecord;
  } catch {
    return null;
  }
};

const resolveRedis = async (redis?: Redis) => redis ?? (await import("./redis.js")).redisCommandClient;

export async function getWorkRoomById(roomId: string, redis?: Redis) {
  const client = await resolveRedis(redis);
  const room = readRoom(await client.get(getRealtimeRoomMetaKey(roomId)));
  if (!room) return null;
  if (Date.parse(room.expiresAt) <= Date.now()) return null;
  return room;
}

export async function getWorkRoomByCode(workId: string, codeValue: unknown, redis?: Redis) {
  const code = normalizeWorkRoomCode(codeValue);
  if (!code) return null;
  const client = await resolveRedis(redis);
  const roomId = await client.get(getRealtimeRoomCodeKey(workId, code));
  if (!roomId) return null;
  const room = await getWorkRoomById(roomId, client);
  if (!room) {
    await client.del(getRealtimeRoomCodeKey(workId, code)).catch(() => undefined);
    return null;
  }
  return room;
}

const randomRoomCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(8), (value) => alphabet[value % alphabet.length]).join("");
};

export async function createWorkRoom(input: {
  workId: string;
  code?: unknown;
  expiresInSeconds?: unknown;
  maxParticipants?: unknown;
  seatPerUser?: unknown;
  redis?: Redis;
}) {
  const options = normalizeWorkRoomOptions(input);
  const redis = await resolveRedis(input.redis);
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + options.expiresInSeconds * 1000;
  const record: WorkRoomRecord = {
    id: randomUUID(),
    workId: input.workId,
    expiresAtMs,
    code: options.code ?? randomRoomCode(),
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    maxParticipants: options.maxParticipants,
    seatPerUser: options.seatPerUser,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0 && options.code) {
      throw new WorkRoomError("room code is already in use", "ROOM_CODE_TAKEN");
    }
    if (attempt > 0) record.code = randomRoomCode();
    const result = await redis.eval(
      CREATE_ROOM_SCRIPT,
      3,
      getRealtimeRoomCodeKey(input.workId, record.code),
      getRealtimeRoomMetaKey(record.id),
      getRealtimeRoomIndexKey(input.workId),
      record.id,
      JSON.stringify(record),
      String(expiresAtMs),
      String(WORK_ROOM_MAX_ACTIVE_PER_WORK),
    );
    const code = Number(result);
    if (code === -1) {
      throw new WorkRoomError(
        `this work already has ${WORK_ROOM_MAX_ACTIVE_PER_WORK} active rooms`,
        "ROOM_QUOTA_EXCEEDED",
      );
    }
    if (code === 1) return record;
  }
  throw new WorkRoomError("unable to allocate a unique room code", "ROOM_CODE_TAKEN");
}

const ticketBase64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");
const ticketSecret = () => {
  if (!config.appEncryptionKey) throw new Error("Missing APP_ENCRYPTION_KEY for work room tickets");
  return config.appEncryptionKey;
};
const ticketSignature = (value: string) => createHmac("sha256", ticketSecret()).update(value).digest();

export type WorkRoomTicketPayload = {
  typ: "work_room_ticket";
  workId: string;
  roomId: string;
  userUuid: string;
  participantId: string;
  userKey: string;
  exp: number;
};

export const createWorkRoomTicket = (input: Omit<WorkRoomTicketPayload, "typ" | "exp"> & { expiresAt: number }) => {
  const payload: WorkRoomTicketPayload = {
    typ: "work_room_ticket",
    workId: input.workId,
    roomId: input.roomId,
    userUuid: input.userUuid,
    participantId: input.participantId,
    userKey: input.userKey,
    exp: Math.floor(input.expiresAt / 1000),
  };
  const header = ticketBase64(JSON.stringify({ alg: "HS256", typ: "COHUB_ROOM" }));
  const body = ticketBase64(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${ticketBase64(ticketSignature(signingInput))}`;
};

export const verifyWorkRoomTicket = (token: string): WorkRoomTicketPayload | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = ticketSignature(`${header}.${body}`);
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as WorkRoomTicketPayload;
    if (
      payload.typ !== "work_room_ticket" ||
      !payload.workId ||
      !payload.roomId ||
      !payload.userUuid ||
      !payload.participantId ||
      !payload.userKey ||
      !Number.isInteger(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) return null;
    return payload;
  } catch {
    return null;
  }
};

/**
 * Opaque, stable identity for a viewer inside one room. Connections of the same
 * viewer share it, which lets a room enforce one seat per viewer and lets an
 * application group participants, without exposing the account id to peers.
 * `secret` is injectable for tests; production always uses the configured key.
 */
export const deriveWorkRoomUserKey = (roomId: string, userUuid: string, secret: string = ticketSecret()) =>
  createHmac("sha256", secret).update(`participant:${roomId}:${userUuid}`).digest("hex").slice(0, 32);

export const createWorkRoomAdmission = (input: {
  workId: string;
  userUuid: string;
  room: WorkRoomRecord;
}) => {
  // Per connection by default: two tabs are two participants. A room created with
  // seatPerUser collapses them at join time using the userKey below.
  const participantId = randomUUID();
  const userKey = deriveWorkRoomUserKey(input.room.id, input.userUuid);
  return {
    room: serializeWorkRoom(input.room),
    participantId,
    userKey,
    ticket: createWorkRoomTicket({
      workId: input.workId,
      roomId: input.room.id,
      userUuid: input.userUuid,
      participantId,
      userKey,
      expiresAt: Date.parse(input.room.expiresAt),
    }),
  };
};
