import { QueueEvents, type Job, type Queue } from "bullmq";
import {
  AGENT_SANDBOX_FS_MUTATION_JOB_NAME,
  buildAgentSandboxFsMutationJobId,
  sandboxFsMutationJobRetention,
  type AgentSandboxFsMutationJobData,
  type AgentSandboxFsMutationJobResult,
} from "@cohub/infra/agent-queue";
import { COHUB_AGENT_TURNS_QUEUE, createBullmqConnectionOptions, createBullmqQueue } from "@cohub/infra/bullmq";
import { getCurrentRequestId } from "@cohub/infra/tracing";
import { injectTrace } from "@cohub/infra/tracing/propagator";
import { createLogger } from "@cohub/infra/logging";
import { config } from "./config.js";

const logger = createLogger({ serviceName: "cohub-api" });

/**
 * Sandbox writes are interactive: fail fast so the route can surface a clean
 * error instead of letting the user wait for a long queue backlog.
 */
export const SANDBOX_FS_MUTATION_TIMEOUT_MS = 30_000;

// Lazy init so importing the filesystem backend (and any unit test that does)
// does not open a Redis connection at module load time.
let queue: Queue<AgentSandboxFsMutationJobData, AgentSandboxFsMutationJobResult, string> | null = null;
let queueEvents: QueueEvents | null = null;
let queueEventsReady: Promise<void> | null = null;

export class SandboxFsMutationTimeoutError extends Error {
  override name = "SandboxFsMutationTimeoutError";

  constructor(cause: unknown) {
    super("sandbox filesystem mutation timed out", { cause });
  }
}

function getQueue() {
  queue ??= createBullmqQueue<AgentSandboxFsMutationJobData, AgentSandboxFsMutationJobResult>(COHUB_AGENT_TURNS_QUEUE, {
    redisUrl: config.bullmqRedisUrl,
    telemetryServiceName: "cohub-api-sandbox-fs",
  });
  return queue;
}

async function getQueueEvents() {
  if (!queueEvents) {
    queueEvents = new QueueEvents(COHUB_AGENT_TURNS_QUEUE, {
      connection: createBullmqConnectionOptions(config.bullmqRedisUrl),
    });
    queueEventsReady = queueEvents.waitUntilReady().then(() => undefined);
  }
  await queueEventsReady;
  return queueEvents;
}

/**
 * Reuse the job for the same space + mutationId while it is retained,
 * including failed jobs. A failed mutation can have an unknown side effect,
 * so retrying it automatically would be less safe than surfacing the same
 * failure to the caller.
 */
async function resolveOrCreateJob(input: AgentSandboxFsMutationJobData): Promise<Job<AgentSandboxFsMutationJobData, AgentSandboxFsMutationJobResult, string>> {
  const q = getQueue();
  const jobId = buildAgentSandboxFsMutationJobId(input.spaceId, input.mutationId, input.mutation);
  const existing = await q.getJob(jobId).catch(() => null);
  if (existing) return existing;
  try {
    return await q.add(AGENT_SANDBOX_FS_MUTATION_JOB_NAME, {
      ...input,
      requestId: getCurrentRequestId() ?? input.requestId ?? null,
      trace: injectTrace(),
    }, {
      jobId,
      attempts: 1,
      // The worker redacts completed write content before this retention window.
      ...sandboxFsMutationJobRetention,
    });
  } catch (error) {
    // Two identical requests can pass getJob at the same time. Reuse the job
    // created by the winner instead of surfacing a duplicate-job error.
    const concurrent = await q.getJob(jobId).catch(() => null);
    if (concurrent) return concurrent;
    throw error;
  }
}

/**
 * Execute a filesystem mutation inside the sandbox through the agent. The job
 * id is scoped by spaceId + mutationId so retries reuse the same job. On
 * timeout we best-effort remove a job that has not started yet, so a queued
 * mutation does not silently land after the API already reported failure.
 */
export async function enqueueSandboxFsMutationJob(input: AgentSandboxFsMutationJobData): Promise<AgentSandboxFsMutationJobResult> {
  const job = await resolveOrCreateJob(input);
  try {
    const events = await getQueueEvents();
    return await job.waitUntilFinished(events, SANDBOX_FS_MUTATION_TIMEOUT_MS) as AgentSandboxFsMutationJobResult;
  } catch (error) {
    // Best-effort cancel: only a job that never started can be removed safely.
    // Active/completed jobs are left alone (completed is our idempotency window).
    if (await job.isWaiting().catch(() => false)) {
      await job.remove().catch(() => undefined);
    }
    logger.warn(`[SandboxFsMutation] job did not settle spaceId=${input.spaceId} mutationId=${input.mutationId} operation=${input.mutation.operation}`, error);
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out|timeout/i.test(message)) throw new SandboxFsMutationTimeoutError(error);
    throw error;
  }
}
