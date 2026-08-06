import { and, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@cohub/db";
import { taskRuns } from "@cohub/db";
import type { TaskPayload } from "@cohub/protocol/task";

export type TaskQueueJobOptions = { [key: string]: unknown; jobId?: string; delay?: number };
export type TaskEnqueueOptions = Omit<TaskQueueJobOptions, "scheduledAt"> & { scheduledAt?: Date | null };

type TasksDb = PostgresJsDatabase<typeof schema>;

export type EnqueueTaskRunInput<Job = unknown> = {
  db: TasksDb;
  payload: TaskPayload;
  options?: TaskEnqueueOptions;
  enqueue: (name: string, payload: TaskPayload, options: TaskQueueJobOptions) => Promise<Job>;
  onTaskCreated?: (taskRun: typeof taskRuns.$inferSelect) => Promise<void> | void;
};

export async function enqueueTaskRun<Job = unknown>(input: EnqueueTaskRunInput<Job>) {
  const requestedJobId = typeof input.options?.jobId === "string" && input.options.jobId.trim()
    ? input.options.jobId.trim()
    : null;
  const taskRunId = crypto.randomUUID();
  const queueJobId = requestedJobId ?? taskRunId;
  const { scheduledAt, jobId: _ignoredJobId, ...jobOptions } = input.options ?? {};
  const delay = typeof jobOptions.delay === "number" ? jobOptions.delay : 0;
  const scheduledAtValue = scheduledAt ?? (delay > 0 ? new Date(Date.now() + delay) : null);

  const [insertedTaskRun] = await input.db.insert(taskRuns).values({
    id: taskRunId,
    jobId: queueJobId,
    taskType: input.payload.type,
    spaceId: input.payload.spaceId ?? null,
    sessionId: input.payload.sessionId ?? null,
    turnId: input.payload.turnId ?? null,
    userUuid: input.payload.userId ?? null,
    cronJobId: input.payload.cronJobId ?? null,
    status: "pending",
    payload: input.payload,
    scheduledAt: scheduledAtValue,
  }).onConflictDoNothing().returning();

  const [existingTaskRun] = insertedTaskRun
    ? []
    : await input.db
        .select()
        .from(taskRuns)
        .where(eq(taskRuns.jobId, queueJobId))
        .limit(1);
  const taskRun = insertedTaskRun ?? existingTaskRun;
  if (!taskRun) throw new Error(`Task run not found after insert conflict for job ${queueJobId}`);

  const shouldEnqueue = Boolean(insertedTaskRun)
    || (taskRun.startedAt == null && (taskRun.status === "pending" || taskRun.status === "failed"));
  if (!shouldEnqueue) return { job: null, taskRunId: taskRun.id };

  try {
    const job = await input.enqueue(input.payload.type, input.payload, {
      ...jobOptions,
      jobId: queueJobId,
    });

    const [recoveredTaskRun] = !insertedTaskRun && taskRun.status === "failed"
      ? await input.db.update(taskRuns).set({
          status: "pending",
          errorMessage: null,
          finishedAt: null,
          updatedAt: new Date(),
        }).where(and(
          eq(taskRuns.id, taskRun.id),
          eq(taskRuns.status, "failed"),
          isNull(taskRuns.startedAt),
        )).returning()
      : [];
    const enqueuedTaskRun = recoveredTaskRun ?? insertedTaskRun;
    if (enqueuedTaskRun) await input.onTaskCreated?.(enqueuedTaskRun);
    return { job, taskRunId: taskRun.id };
  } catch (error) {
    await input.db.update(taskRuns).set({
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(taskRuns.id, taskRun.id),
      isNull(taskRuns.startedAt),
    )).catch(() => undefined);
    throw error;
  }
}
