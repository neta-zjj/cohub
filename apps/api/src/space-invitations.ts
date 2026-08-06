import { randomBytes } from "node:crypto";
import { spaces, userProfiles } from "@cohub/db";
import type { SpaceRole } from "@cohub/db";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { redisCommandClient } from "./redis.js";

const INVITE_PREFIX = "invite";
const INVITATION_SCAN_BATCH_SIZE = 100;
const INVITATION_TOKEN_CREATE_ATTEMPTS = 5;
export const MAX_SPACE_INVITATIONS = 100;

const CREATE_INVITATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return "token_exists"
end

if redis.call("SCARD", KEYS[2]) >= tonumber(ARGV[9]) then
  return "limit_reached"
end

redis.call(
  "HSET",
  KEYS[1],
  "space_id", ARGV[1],
  "space_name", ARGV[2],
  "creator_id", ARGV[3],
  "role", ARGV[4],
  "max_uses", ARGV[5],
  "use_count", "0",
  "status", "active",
  "created_at", ARGV[6]
)
local ttl_seconds = tonumber(ARGV[7])
redis.call("EXPIRE", KEYS[1], ttl_seconds)
redis.call("SADD", KEYS[2], ARGV[8])
local current_ttl = redis.call("TTL", KEYS[2])
if current_ttl < 0 or current_ttl < ttl_seconds then
  redis.call("EXPIRE", KEYS[2], ttl_seconds)
end
return "created"
`;

const RESERVE_INVITATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return "missing"
end

local status = redis.call("HGET", KEYS[1], "status")
if status == "revoked" then
  return "revoked"
end

local max_uses = tonumber(redis.call("HGET", KEYS[1], "max_uses") or "0")
local use_count = tonumber(redis.call("HGET", KEYS[1], "use_count") or "0")
if status == "exhausted" or (max_uses > 0 and use_count >= max_uses) then
  redis.call("HSET", KEYS[1], "status", "exhausted")
  return "exhausted"
end

local next_count = redis.call("HINCRBY", KEYS[1], "use_count", 1)
if max_uses > 0 and next_count >= max_uses then
  redis.call("HSET", KEYS[1], "status", "exhausted")
end
return "reserved"
`;

const RELEASE_INVITATION_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0
end

local use_count = tonumber(redis.call("HGET", KEYS[1], "use_count") or "0")
if use_count <= 0 then
  return 0
end

local next_count = redis.call("HINCRBY", KEYS[1], "use_count", -1)
local status = redis.call("HGET", KEYS[1], "status")
local max_uses = tonumber(redis.call("HGET", KEYS[1], "max_uses") or "0")
if status == "exhausted" and (max_uses == 0 or next_count < max_uses) then
  redis.call("HSET", KEYS[1], "status", "active")
end
return 1
`;

export type InvitationUseReservation =
  | "reserved"
  | "missing"
  | "revoked"
  | "exhausted";

export type StoreSpaceInvitationResult =
  | "created"
  | "limit_reached"
  | "token_exists";

export type CreateSpaceInvitationResult = {
  token: string;
  status: Exclude<StoreSpaceInvitationResult, "token_exists">;
};

export type ListedSpaceInvitation = {
  token: string;
  role: SpaceRole;
  status: string;
  useCount: number;
  maxUses: number | null;
  createdAt: string | null;
  expiresInSeconds: number | null;
};

export type InvitationSpaceLocation = {
  spaceId: string;
  spaceName: string;
  spaceSlug: string | null;
  ownerUsername: string | null;
};

export type StoreSpaceInvitationInput = {
  token: string;
  spaceId: string;
  spaceName: string;
  creatorId: string;
  role: SpaceRole;
  maxUses: number;
  createdAt: string;
  ttlSeconds: number;
};

type InvitationStoreClient = {
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
};

type InvitationPipeline = {
  hgetall(key: string): InvitationPipeline;
  ttl(key: string): InvitationPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
};

type InvitationListClient = {
  sscan(key: string, cursor: string, count: "COUNT", size: number): Promise<[string, string[]]>;
  pipeline(): InvitationPipeline;
  srem(key: string, ...members: string[]): Promise<number>;
};

export function invitationKey(token: string) {
  return `${INVITE_PREFIX}:${token}`;
}

export function spaceInvitationIndexKey(spaceId: string) {
  return `${INVITE_PREFIX}:space:${spaceId}`;
}

export function generateInvitationToken() {
  return randomBytes(9).toString("base64url");
}

export async function getInvitationSpaceLocation(
  spaceId: string,
): Promise<InvitationSpaceLocation | null> {
  const [space] = await db
    .select({
      spaceId: spaces.id,
      spaceName: spaces.name,
      spaceSlug: spaces.slug,
      ownerUsername: userProfiles.username,
    })
    .from(spaces)
    .leftJoin(userProfiles, eq(userProfiles.userUuid, spaces.userUuid))
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return space ?? null;
}

export async function storeSpaceInvitation(
  input: StoreSpaceInvitationInput,
  client: InvitationStoreClient = redisCommandClient,
): Promise<StoreSpaceInvitationResult> {
  const result = await client.eval(
    CREATE_INVITATION_SCRIPT,
    2,
    invitationKey(input.token),
    spaceInvitationIndexKey(input.spaceId),
    input.spaceId,
    input.spaceName,
    input.creatorId,
    input.role,
    String(input.maxUses),
    input.createdAt,
    String(input.ttlSeconds),
    input.token,
    String(MAX_SPACE_INVITATIONS),
  );
  return result as StoreSpaceInvitationResult;
}

export async function createSpaceInvitation(
  input: Omit<StoreSpaceInvitationInput, "token">,
  client: InvitationStoreClient = redisCommandClient,
  generateToken: () => string = generateInvitationToken,
): Promise<CreateSpaceInvitationResult> {
  for (let attempt = 0; attempt < INVITATION_TOKEN_CREATE_ATTEMPTS; attempt += 1) {
    const token = generateToken();
    const status = await storeSpaceInvitation({ ...input, token }, client);
    if (status !== "token_exists") return { token, status };
  }
  throw new Error("Failed to generate a unique invitation code");
}

export async function listSpaceInvitations(
  spaceId: string,
  client: InvitationListClient = redisCommandClient,
): Promise<ListedSpaceInvitation[]> {
  const indexKey = spaceInvitationIndexKey(spaceId);
  const invitations: ListedSpaceInvitation[] = [];
  const seenTokens = new Set<string>();
  const staleTokens = new Set<string>();
  let cursor = "0";

  do {
    const [nextCursor, scannedTokens] = await client.sscan(
      indexKey,
      cursor,
      "COUNT",
      INVITATION_SCAN_BATCH_SIZE,
    );
    cursor = nextCursor;
    const tokens = scannedTokens.filter((token) => {
      if (seenTokens.has(token)) return false;
      seenTokens.add(token);
      return true;
    });
    if (tokens.length === 0) continue;

    const pipeline = client.pipeline();
    for (const token of tokens) {
      pipeline.hgetall(invitationKey(token));
      pipeline.ttl(invitationKey(token));
    }
    const rows = await pipeline.exec();
    if (!rows) throw new Error("Failed to read space invitations");

    tokens.forEach((token, index) => {
      const dataRow = rows[index * 2];
      const ttlRow = rows[index * 2 + 1];
      if (dataRow?.[0]) throw dataRow[0];
      if (ttlRow?.[0]) throw ttlRow[0];

      const data = dataRow?.[1] as Record<string, string> | undefined;
      if (!data || Object.keys(data).length === 0) {
        staleTokens.add(token);
        return;
      }
      const ttl = ttlRow?.[1];
      invitations.push({
        token,
        role: data.role as SpaceRole,
        status: data.status ?? "active",
        useCount: Number.parseInt(data.use_count ?? "0", 10),
        maxUses: Number.parseInt(data.max_uses ?? "0", 10) || null,
        createdAt: data.created_at ?? null,
        expiresInSeconds: typeof ttl === "number" && ttl > 0 ? ttl : null,
      });
    });
  } while (cursor !== "0");

  const staleTokenList = [...staleTokens];
  for (let index = 0; index < staleTokenList.length; index += INVITATION_SCAN_BATCH_SIZE) {
    await client.srem(
      indexKey,
      ...staleTokenList.slice(index, index + INVITATION_SCAN_BATCH_SIZE),
    );
  }

  return invitations.sort((left, right) =>
    (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
  );
}

export async function reserveInvitationUse(
  token: string,
): Promise<InvitationUseReservation> {
  const result = await redisCommandClient.eval(
    RESERVE_INVITATION_SCRIPT,
    1,
    invitationKey(token),
  );
  return result as InvitationUseReservation;
}

export async function releaseInvitationUse(token: string): Promise<void> {
  await redisCommandClient.eval(
    RELEASE_INVITATION_SCRIPT,
    1,
    invitationKey(token),
  );
}
