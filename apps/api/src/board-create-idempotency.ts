import { createHash } from "node:crypto";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uuidFromSeed(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildBoardCreateIdentity(input: {
  spaceId: string;
  mutationId?: string;
  payload: unknown;
}) {
  if (!input.mutationId) return null;
  const fingerprint = createHash("sha256").update(canonicalJson(input.payload)).digest("hex");
  const scope = `${input.spaceId}\0${input.mutationId}\0${fingerprint}`;
  return {
    boardId: uuidFromSeed(`board\0${scope}`),
    transactionId: uuidFromSeed(`transaction\0${scope}`),
  };
}
