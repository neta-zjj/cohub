import { Redis } from "ioredis";
import { env } from "./env.js";
import { createLogger } from "@cohub/infra/logging";


const logger = createLogger({ serviceName: "cohub-agent" });
export const SANDBOX_EVENTS_CHANNEL = "pubsub:sandbox:events";

export type SandboxLifecycleEvent = {
  id: string;
  type: "sandbox.replacing";
  spaceId: string;
  reason: string;
  source?: string | null;
  generation?: string | null;
  podName?: string | null;
  timestamp: number;
};

let subscriber: Redis | null = null;

function getSubscriber() {
  if (subscriber) return subscriber;
  subscriber = new Redis(env.REDIS_URL, { lazyConnect: true, disableClientInfo: true });
  subscriber.on("error", (error) => {
    logger.warn("[SandboxEvents] Redis subscriber error", error);
  });
  return subscriber;
}

function parseSandboxLifecycleEvent(raw: string): SandboxLifecycleEvent | null {
  try {
    const value = JSON.parse(raw) as Partial<SandboxLifecycleEvent>;
    if (!value || typeof value !== "object") return null;
    if (value.type !== "sandbox.replacing") return null;
    if (typeof value.spaceId !== "string" || !value.spaceId) return null;
    return {
      id: typeof value.id === "string" ? value.id : "",
      type: value.type,
      spaceId: value.spaceId,
      reason: typeof value.reason === "string" ? value.reason : "unknown",
      source: typeof value.source === "string" ? value.source : null,
      generation: typeof value.generation === "string" ? value.generation : null,
      podName: typeof value.podName === "string" ? value.podName : null,
      timestamp: typeof value.timestamp === "number" ? value.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function subscribeSandboxLifecycleEvents(handler: (event: SandboxLifecycleEvent) => void) {
  const client = getSubscriber();
  await client.connect();
  await client.subscribe(SANDBOX_EVENTS_CHANNEL);
  client.on("message", (channel, raw) => {
    if (channel !== SANDBOX_EVENTS_CHANNEL) return;
    const event = parseSandboxLifecycleEvent(raw);
    if (!event) {
      logger.warn("[SandboxEvents] invalid sandbox lifecycle event");
      return;
    }
    handler(event);
  });
}

export async function closeSandboxLifecycleEventSubscriber() {
  const client = subscriber;
  subscriber = null;
  await client?.quit();
}
