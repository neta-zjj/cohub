import { Redis } from "ioredis";
import { AGENT_INSTANCE_HEARTBEAT_MS, env } from "./env.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-agent" });
const redis = new Redis(env.REDIS_URL, { disableClientInfo: true });

export type AgentInstanceRecord = {
  instanceId: string;
  podName: string;
  hostname: string;
  status: "ready" | "degraded" | "stopping";
  startedAt: number;
  lastHeartbeatAt: number;
  version?: string;
};

export type SessionOwnerLease = {
  spaceId: string;
  sessionId: string;
  ownerId: string;
  leaseUntil: number;
  epoch: number;
  claimedAt: number;
  updatedAt: number;
};

export function getAgentInstanceKey(instanceId: string) {
  return `agent:instance:${instanceId}`;
}

export function getAgentInstanceInputQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:input_queue`;
}

export function getAgentInstanceProcessingQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:processing_queue`;
}

export function getAgentInstanceDeadLetterQueueKey(instanceId: string) {
  return `agent:instance:${instanceId}:dead_letter_queue`;
}

export function getSessionOwnerKey(spaceId: string, sessionId: string) {
  return `agent:session_owner:${spaceId}:${sessionId}`;
}

export function getSpaceRuntimeKey(spaceId: string) {
  return `agent:space_runtime:${spaceId}`;
}

export async function heartbeatAgentInstance(status: AgentInstanceRecord["status"] = "ready") {
  const now = Date.now();
  const payload: AgentInstanceRecord = {
    instanceId: env.AGENT_INSTANCE_ID,
    podName: process.env.HOSTNAME?.trim() || env.AGENT_INSTANCE_ID,
    hostname: process.env.HOSTNAME?.trim() || env.AGENT_INSTANCE_ID,
    status,
    startedAt: Number(process.env.AGENT_STARTED_AT ?? now),
    lastHeartbeatAt: now,
    version: env.AGENT_VERSION,
  };

  const ttlSeconds = Math.max(1, Math.ceil((AGENT_INSTANCE_HEARTBEAT_MS * 3) / 1000));
  await redis.set(getAgentInstanceKey(env.AGENT_INSTANCE_ID), JSON.stringify(payload), "EX", ttlSeconds);
}

export async function listActiveAgentInstances(): Promise<AgentInstanceRecord[]> {
  const keys = await redis.keys("agent:instance:*");
  if (keys.length === 0) return [];
  const values = await redis.mget(keys);
  const now = Date.now();
  return values
    .map((raw) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as AgentInstanceRecord;
      } catch {
        return null;
      }
    })
    .filter((item): item is AgentInstanceRecord => {
      return item !== null && item.lastHeartbeatAt <= now && item.status !== "stopping";
    })
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

export function startAgentInstanceHeartbeatLoop() {
  void heartbeatAgentInstance("ready").catch((error) => {
    logger.error("[Ownership] Initial agent heartbeat failed:", error);
  });

  return setInterval(() => {
    void heartbeatAgentInstance("ready").catch((error) => {
      logger.error("[Ownership] Agent heartbeat failed:", error);
    });
  }, AGENT_INSTANCE_HEARTBEAT_MS);
}

export const SESSION_OWNER_LEASE_MS = 20_000;

export async function getSessionOwner(spaceId: string, sessionId: string): Promise<SessionOwnerLease | null> {
  const raw = await redis.get(getSessionOwnerKey(spaceId, sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionOwnerLease;
  } catch {
    return null;
  }
}

export async function claimSessionOwner(spaceId: string, sessionId: string): Promise<SessionOwnerLease> {
  const key = getSessionOwnerKey(spaceId, sessionId);
  const now = Date.now();
  const leaseUntil = now + SESSION_OWNER_LEASE_MS;

  const result = await redis.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local now = tonumber(ARGV[2])
local leaseUntil = tonumber(ARGV[3])

local raw = redis.call('GET', key)
if not raw then
  local payload = cjson.encode({
    spaceId = ARGV[4],
    sessionId = ARGV[5],
    ownerId = ownerId,
    leaseUntil = leaseUntil,
    epoch = 1,
    claimedAt = now,
    updatedAt = now
  })
  redis.call('SET', key, payload)
  return payload
end

local decoded = cjson.decode(raw)
if tonumber(decoded.leaseUntil or 0) <= now or decoded.ownerId == ownerId then
  local nextEpoch = tonumber(decoded.epoch or 0)
  if decoded.ownerId ~= ownerId then
    nextEpoch = nextEpoch + 1
  end
  decoded.ownerId = ownerId
  decoded.leaseUntil = leaseUntil
  decoded.epoch = nextEpoch
  decoded.updatedAt = now
  if not decoded.claimedAt then decoded.claimedAt = now end
  local payload = cjson.encode(decoded)
  redis.call('SET', key, payload)
  return payload
end

return raw
    `,
    1,
    key,
    env.AGENT_INSTANCE_ID,
    String(now),
    String(leaseUntil),
    spaceId,
    sessionId,
  );

  return JSON.parse(String(result)) as SessionOwnerLease;
}

export async function renewSessionOwner(spaceId: string, sessionId: string, epoch: number): Promise<boolean> {
  const key = getSessionOwnerKey(spaceId, sessionId);
  const now = Date.now();
  const leaseUntil = now + SESSION_OWNER_LEASE_MS;

  const result = await redis.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local epoch = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local leaseUntil = tonumber(ARGV[4])

local raw = redis.call('GET', key)
if not raw then
  return 0
end

local decoded = cjson.decode(raw)
if decoded.ownerId ~= ownerId then
  return 0
end
if tonumber(decoded.epoch or 0) ~= epoch then
  return 0
end

decoded.leaseUntil = leaseUntil
decoded.updatedAt = now
redis.call('SET', key, cjson.encode(decoded))
return 1
    `,
    1,
    key,
    env.AGENT_INSTANCE_ID,
    String(epoch),
    String(now),
    String(leaseUntil),
  );

  return Number(result) === 1;
}

export async function releaseSessionOwner(spaceId: string, sessionId: string, epoch?: number): Promise<boolean> {
  const key = getSessionOwnerKey(spaceId, sessionId);
  const result = await redis.eval(
    `
local key = KEYS[1]
local ownerId = ARGV[1]
local epoch = ARGV[2]
local raw = redis.call('GET', key)
if not raw then
  return 1
end
local decoded = cjson.decode(raw)
if decoded.ownerId ~= ownerId then
  return 0
end
local epochNum = tonumber(epoch)
if epochNum ~= nil and tonumber(decoded.epoch or 0) ~= epochNum then
  return 0
end
redis.call('DEL', key)
return 1
    `,
    1,
    key,
    env.AGENT_INSTANCE_ID,
    epoch === undefined ? "" : String(epoch),
  );
  return Number(result) === 1;
}

export async function resolveOrClaimSessionOwner(spaceId: string, sessionId: string): Promise<SessionOwnerLease> {
  const existing = await getSessionOwner(spaceId, sessionId);
  const now = Date.now();
  if (existing && existing.leaseUntil > now) return existing;
  return claimSessionOwner(spaceId, sessionId);
}

export async function updateSpaceRuntime(input: {
  spaceId: string;
  status: "idle" | "ready" | "error";
  sandboxId?: string | null;
  error?: string | null;
}) {
  const key = getSpaceRuntimeKey(input.spaceId);
  const existingRaw = await redis.get(key);
  const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, unknown>) : {};
  const next = {
    ...existing,
    spaceId: input.spaceId,
    ownerId: env.AGENT_INSTANCE_ID,
    status: input.status,
    sandboxId: input.sandboxId ?? existing.sandboxId ?? null,
    error: input.error ?? null,
    updatedAt: Date.now(),
  };
  await redis.set(key, JSON.stringify(next), "EX", Math.max(30, Math.ceil((SESSION_OWNER_LEASE_MS * 4) / 1000)));
}

export async function closeOwnershipRedis() {
  await redis.quit().catch(() => redis.disconnect());
}
