import assert from "node:assert/strict";
import { test } from "node:test";
import type { CohubHttpClient } from "@neta-art/cohub";
import { Command } from "commander";
import { registerTasks } from "../src/commands/tasks.js";

type TaskListFilters = Parameters<CohubHttpClient["tasks"]["list"]>[0];

async function parseTaskList(argv: string[]): Promise<TaskListFilters> {
  let receivedFilters: TaskListFilters;
  const program = new Command("cohub").option("-s, --space <id>");
  registerTasks(program, {
    createClient: () => ({
      tasks: {
        list: async (filters: TaskListFilters) => {
          receivedFilters = filters;
          return { runs: [] };
        },
      },
    }) as unknown as CohubHttpClient,
  });

  const originalLog = console.log;
  console.log = () => undefined;
  try {
    await program.parseAsync(["node", "cohub", ...argv]);
  } finally {
    console.log = originalLog;
  }

  assert.ok(receivedFilters);
  return receivedFilters;
}

test("tasks ls passes a trailing --space filter to the API", async () => {
  const filters = await parseTaskList(["tasks", "ls", "--space", "space-1"]);
  assert.equal(filters?.spaceId, "space-1");
});

test("tasks ls accepts the root space option", async () => {
  const filters = await parseTaskList(["--space", "space-2", "tasks", "ls"]);
  assert.equal(filters?.spaceId, "space-2");
});
