import type { TaskRunRecord } from "@neta-art/cohub";
import type { Command } from "commander";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, handleHttp } from "../output.js";

type TasksClient = ReturnType<typeof createClient>;

type RegisterTasksDependencies = {
  createClient?: () => TasksClient;
};

export function registerTasks(program: Command, dependencies: RegisterTasksDependencies = {}): void {
  const getClient = dependencies.createClient ?? createClient;
  const cmd = program.command("tasks", { hidden: true }).description("Task runs");

  cmd
    .command("ls")
    .alias("list")
    .description("List task runs")
    .option("--cron-job <id>", "Filter by cron job")
    .option("--space <id>", "Filter by space")
    .option("--session <id>", "Filter by session")
    .option("--type <type>", "Filter by task type")
    .option("--status <status>", "Filter by status: active, pending, running, completed, failed")
    .option("--limit <n>", "Page size", "50")
    .option("--cursor <cursor>", "Page cursor")
    .option("--json", "Output as JSON")
    .action(async (opts: { cronJob?: string; space?: string; session?: string; type?: string; status?: "active" | TaskRunRecord["status"]; limit?: string; cursor?: string; json?: boolean }) => {
      const client = getClient();
      try {
        const limit = opts.limit ? Number(opts.limit) : 50;
        if (!Number.isFinite(limit) || limit < 1) throw new Error("limit must be a positive number");
        const filters: Parameters<typeof client.tasks.list>[0] = { limit: Math.floor(limit) };
        const spaceId = opts.space ?? (program.opts() as { space?: string }).space;
        if (opts.cronJob) filters.cronJobId = opts.cronJob;
        if (spaceId) filters.spaceId = spaceId;
        if (opts.session) filters.sessionId = opts.session;
        if (opts.type) filters.taskType = opts.type;
        if (opts.status) filters.status = opts.status;
        if (opts.cursor) filters.cursor = opts.cursor;

        const result = await client.tasks.list(filters);
        if (jsonRequested(opts)) return outJson(result);
        if (result.runs.length === 0) return console.log("  (empty)");
        table(result.runs, [
          { key: "id", label: "ID" },
          { key: "taskType", label: "Type" },
          { key: "status", label: "Status" },
          { key: "sessionId", label: "Session" },
          { key: "createdAt", label: "Created" },
        ]);
        if (result.pageInfo?.hasMore && result.pageInfo.nextCursor) {
          console.log(`\n  More task runs available — next cursor: ${result.pageInfo.nextCursor}`);
        }
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("get <id>")
    .description("Task run details")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      const client = getClient();
      try {
        const result = await client.tasks.get(id);
        if (jsonRequested(opts)) return outJson(result);
        table([result.run], [
          { key: "id", label: "ID" },
          { key: "taskType", label: "Type" },
          { key: "status", label: "Status" },
          { key: "attemptCount", label: "Attempts" },
          { key: "createdAt", label: "Created" },
        ]);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

}
