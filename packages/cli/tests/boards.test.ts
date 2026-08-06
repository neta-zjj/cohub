import assert from "node:assert/strict";
import { test } from "node:test";
import { Command } from "commander";
import {
  createTransactionInput,
  parseInspectSections,
  parseJsonObject,
  parseViewport,
  registerBoards,
} from "../src/commands/boards.js";

function createProgram(): { program: Command; boards: Command } {
  const program = new Command("cohub")
    .option("-s, --space <id>", "Target space ID")
    .helpOption("-h, --help", "Show help");
  return { program, boards: registerBoards(program) };
}

test("Board commands and every subcommand expose -h", () => {
  const { boards } = createProgram();
  const names = boards.commands.map((command) => command.name());
  assert.deepEqual(names, [
    "create",
    "inspect",
    "capabilities",
    "validate",
    "apply",
    "export",
    "play",
    "pause",
    "seek",
    "stop",
    "watch",
  ]);
  assert.match(boards.helpInformation(), /-h, --help/);
  for (const command of boards.commands) {
    assert.match(command.helpInformation(), /-h, --help/, `${command.name()} is missing -h`);
  }
  const play = boards.commands.find((command) => command.name() === "play");
  assert.ok(play);
  assert.doesNotMatch(play.helpInformation(), /--loop/);
});

test("Board JSON and inspect inputs are parsed without rewriting payload data", () => {
  const value = parseJsonObject('{"nodes":[{"type":"custom.node","data":{"raw":true}}]}');
  assert.deepEqual(value, {
    nodes: [{ type: "custom.node", data: { raw: true } }],
  });
  assert.deepEqual(parseInspectSections("nodes, clips,nodes"), ["nodes", "clips"]);
  assert.deepEqual(parseViewport("-10,20,1280,720"), {
    x: -10,
    y: 20,
    width: 1280,
    height: 720,
  });
  assert.throws(() => parseJsonObject("[]"), /JSON object/);
  assert.throws(() => parseInspectSections("nodes,unknown"), /Unknown Board section/);
  assert.throws(() => parseViewport("0,0,0,100"), /greater than zero/);
  assert.throws(() => parseViewport("0,0,,100"), /finite number/);
});

test("transaction input generates identity and rejects a conflicting boardId", () => {
  const transaction = createTransactionInput({
    baseVersion: 4,
    clientId: "cli-test",
    operations: [{ type: "board.patch", payload: { patch: { title: "Plan" } } }],
  }, {});
  assert.equal(transaction.baseVersion, 4);
  assert.equal(transaction.clientId, "cli-test");
  assert.match(transaction.txId, /^[0-9a-f-]{36}$/);
  assert.throws(() => createTransactionInput({
    boardId: "other-board",
    baseVersion: 4,
    operations: [],
  }, {}), /must not contain boardId/);
});
