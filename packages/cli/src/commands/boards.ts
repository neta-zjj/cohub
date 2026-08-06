import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type {
  BoardBootstrap,
  BoardCreateInput,
  BoardInspectInput,
  BoardPlaybackSnapshot,
  BoardTransactionInput,
  BoardValidationResult,
} from "@neta-art/cohub";
import type { BoardExportRegion } from "@neta-art/cohub/board";
import type { Command } from "commander";
import { BOARD_EXPORT_FORMATS, formatFromPath, runBoardExport } from "../board-export.js";
import { createClient, createRealtimeClient } from "../client.js";
import { error, handleHttp, json as outJson, jsonRequested, ok, table } from "../output.js";
import { resolveSpace } from "../space.js";

const INSPECT_SECTIONS = ["nodes", "effects", "sequences", "clips", "playback"] as const;
type InspectSection = (typeof INSPECT_SECTIONS)[number];
type JsonOptions = { json?: boolean };
type InputOptions = JsonOptions & { input: string; txId?: string; baseVersion?: string };
type PlaybackOptions = JsonOptions & { commandId?: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonObject(text: string, source = "input"): Record<string, unknown> {
  if (!text.trim()) throw new Error(`${source} is empty`);
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`${source} must contain valid JSON`, { cause });
  }
  if (!isObject(value)) throw new Error(`${source} must contain a JSON object`);
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonObject(source: string): Promise<Record<string, unknown>> {
  const text = source === "-" ? await readStdin() : await readFile(source, "utf8");
  return parseJsonObject(text, source === "-" ? "stdin" : source);
}

function parseNumber(value: string, name: string, options: { min?: number; max?: number; integer?: boolean } = {}): number {
  if (!value.trim()) throw new Error(`${name} must be a finite number`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  if (options.integer && !Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`);
  if (options.min !== undefined && parsed < options.min) throw new Error(`${name} must be at least ${options.min}`);
  if (options.max !== undefined && parsed > options.max) throw new Error(`${name} must be at most ${options.max}`);
  return parsed;
}

export function parseInspectSections(value?: string): InspectSection[] | undefined {
  if (!value) return undefined;
  const sections = value.split(",").map((item) => item.trim()).filter(Boolean);
  const unknown = sections.filter((section) => !INSPECT_SECTIONS.includes(section as InspectSection));
  if (unknown.length > 0) throw new Error(`Unknown Board section: ${unknown.join(", ")}`);
  return [...new Set(sections)] as InspectSection[];
}

export function parseViewport(value?: string): BoardInspectInput["viewport"] {
  if (!value) return undefined;
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 4) throw new Error("viewport must be x,y,width,height");
  const [xValue, yValue, widthValue, heightValue] = parts;
  if (xValue === undefined || yValue === undefined || widthValue === undefined || heightValue === undefined) {
    throw new Error("viewport must be x,y,width,height");
  }
  const x = parseNumber(xValue, "viewport x");
  const y = parseNumber(yValue, "viewport y");
  const width = parseNumber(widthValue, "viewport width");
  const height = parseNumber(heightValue, "viewport height");
  if (width <= 0 || height <= 0) throw new Error("viewport width and height must be greater than zero");
  return { x, y, width, height };
}

export function createTransactionInput(
  input: Record<string, unknown>,
  options: { txId?: string; baseVersion?: string },
): BoardTransactionInput {
  if ("boardId" in input) throw new Error("transaction input must not contain boardId");
  if (!Array.isArray(input.operations)) throw new Error("transaction input must contain an operations array");
  const rawBaseVersion = options.baseVersion ?? input.baseVersion;
  if (rawBaseVersion === undefined) throw new Error("baseVersion is required in input or --base-version");
  const baseVersion = parseNumber(String(rawBaseVersion), "baseVersion", { min: 0, integer: true });
  const rawTxId = options.txId ?? input.txId;
  if (rawTxId !== undefined && (typeof rawTxId !== "string" || !rawTxId.trim())) {
    throw new Error("txId must be a non-empty string");
  }
  return {
    ...input,
    txId: typeof rawTxId === "string" ? rawTxId : randomUUID(),
    baseVersion,
    operations: input.operations,
  } as BoardTransactionInput;
}

function showBoard(result: BoardBootstrap): void {
  table([
    {
      id: result.board.id,
      title: result.board.title,
      version: result.board.version,
      nodes: result.nodes.length,
      effects: result.effects.length,
      sequences: result.sequences.length,
      clips: result.clips.length,
    },
  ], [
    { key: "id", label: "ID" },
    { key: "title", label: "Title" },
    { key: "version", label: "Version" },
    { key: "nodes", label: "Nodes" },
    { key: "effects", label: "Effects" },
    { key: "sequences", label: "Sequences" },
    { key: "clips", label: "Clips" },
  ]);
}

function showValidation(result: BoardValidationResult): void {
  table([{ valid: result.valid, diagnostics: result.diagnostics.length }], [
    { key: "valid", label: "Valid" },
    { key: "diagnostics", label: "Diagnostics" },
  ]);
  if (result.diagnostics.length > 0) {
    console.log();
    table(result.diagnostics, [
      { key: "severity", label: "Severity" },
      { key: "code", label: "Code" },
      { key: "path", label: "Path" },
      { key: "message", label: "Message" },
    ]);
  }
  console.log();
  table([result.peakCost], Object.keys(result.peakCost).map((key) => ({ key, label: key })));
}

function showPlayback(result: BoardPlaybackSnapshot): void {
  table([result], [
    { key: "playbackId", label: "Playback ID" },
    { key: "sequenceId", label: "Sequence" },
    { key: "status", label: "Status" },
    { key: "position", label: "Position" },
    { key: "timeScale", label: "Time Scale" },
  ]);
}

function withJson(command: Command): Command {
  return command.option("--json", "Output as JSON");
}

function registerTransactionCommand(boards: Command, name: "validate" | "apply"): void {
  withJson(boards.command(`${name} <board-id>`)
    .description(name === "validate" ? "Validate a transaction" : "Apply a transaction")
    .requiredOption("-i, --input <file>", "Transaction JSON file; use - for stdin")
    .option("--tx-id <id>", "Override txId; generated when omitted")
    .option("--base-version <version>", "Override baseVersion"))
    .action(async (boardId: string, options: InputOptions) => {
      try {
        const transaction = createTransactionInput(await readJsonObject(options.input), options);
        const board = createClient().space(resolveSpace(boards)).board(boardId);
        const result = await board[name](transaction);
        if (jsonRequested(options)) return outJson(result);
        if (name === "validate") showValidation(result as BoardValidationResult);
        else {
          ok(`Board updated to version ${(result as BoardBootstrap).board.version}`);
          showBoard(result as BoardBootstrap);
        }
      } catch (cause) {
        handleHttp(cause);
      }
    });
}

function commandId(options: PlaybackOptions): string {
  return options.commandId?.trim() || randomUUID();
}

type ExportOptions = JsonOptions & {
  out?: string;
  scale?: string;
  padding?: string;
  frame?: string;
  items?: string;
  rect?: string;
  theme?: string;
  background?: string;
  format?: string;
  quality?: string;
  images?: boolean;
};

/**
 * Resolve the mutually exclusive region flags.
 *
 * Selecting more than one is rejected rather than silently ranked: "why did
 * --items win over --frame" is a worse experience than being told to pick one.
 */
function parseExportRegion(options: ExportOptions): BoardExportRegion {
  const chosen = [
    options.frame ? "--frame" : null,
    options.items ? "--items" : null,
    options.rect ? "--rect" : null,
  ].filter(Boolean);
  if (chosen.length > 1) {
    throw new Error(`Pick one region: ${chosen.join(", ")} cannot be combined`);
  }
  if (options.frame) return { kind: "frame", id: options.frame };
  if (options.items) {
    const ids = options.items.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error("--items needs at least one node id");
    return { kind: "items", ids };
  }
  if (options.rect) {
    const rect = parseViewport(options.rect);
    if (!rect) throw new Error("--rect must be x,y,width,height");
    return { kind: "rect", rect };
  }
  return { kind: "all" };
}

function parseExportFormat(options: ExportOptions, outPath: string) {
  if (!options.format) return formatFromPath(outPath);
  const format = options.format.toLowerCase();
  if (!BOARD_EXPORT_FORMATS.includes(format as (typeof BOARD_EXPORT_FORMATS)[number])) {
    throw new Error(`Unknown format "${options.format}"; use ${BOARD_EXPORT_FORMATS.join(", ")}`);
  }
  return format as (typeof BOARD_EXPORT_FORMATS)[number];
}

function parseColorMode(value: string | undefined): "dark" | "light" {
  if (!value || value === "dark") return "dark";
  if (value === "light") return "light";
  throw new Error('--theme must be "dark" or "light"');
}

function parseBackground(value: string | undefined): "paper" | "transparent" {
  if (!value || value === "paper") return "paper";
  if (value === "transparent") return "transparent";
  throw new Error('--background must be "paper" or "transparent"');
}

function registerExportCommand(boards: Command): void {
  withJson(boards.command("export <board>")
    .description("Render a Board to an image (board id or .board path)")
    .requiredOption("-o, --out <file>", "Output file; extension selects the format")
    .option("--scale <factor>", "Output pixels per world unit", "2")
    .option("--padding <units>", "World-space padding around the content")
    .option("--frame <node-id>", "Export a single frame as a page")
    .option("--items <ids>", "Comma-separated node ids to export")
    .option("--rect <rect>", "World rect as x,y,width,height")
    .option("--theme <mode>", "dark or light", "dark")
    .option("--background <mode>", "paper or transparent", "paper")
    .option("--format <format>", `Override format (${BOARD_EXPORT_FORMATS.join(", ")})`)
    .option("--quality <q>", "JPEG/WebP quality from 0 to 1", "0.92")
    .option("--no-images", "Skip image downloads and draw placeholders"))
    .action(async (board: string, options: ExportOptions) => {
      try {
        const out = options.out;
        if (!out) throw new Error("--out is required");
        const result = await runBoardExport({
          spaceId: resolveSpace(boards),
          target: board,
          region: parseExportRegion(options),
          scale: parseNumber(options.scale ?? "2", "scale", { min: 0.01, max: 16 }),
          ...(options.padding === undefined
            ? {}
            : { padding: parseNumber(options.padding, "padding", { min: 0 }) }),
          colorScheme: parseColorMode(options.theme),
          background: parseBackground(options.background),
          format: parseExportFormat(options, out),
          quality: parseNumber(options.quality ?? "0.92", "quality", { min: 0, max: 1 }),
          withImages: options.images !== false,
        });
        if (!result) {
          return error(
            "Nothing to export",
            "The selected region contains no items.",
          );
        }
        await writeFile(out, result.bytes);
        if (jsonRequested(options)) {
          return outJson({
            path: out,
            width: result.width,
            height: result.height,
            scale: result.scale,
            items: result.itemCount,
            format: result.format,
            bytes: result.bytes.length,
            warnings: result.warnings,
          });
        }
        ok(`Exported ${result.width}×${result.height} ${result.format.toUpperCase()} to ${out}`);
        for (const warning of result.warnings) console.log(`  ! ${warning}`);
      } catch (cause) {
        handleHttp(cause);
      }
    });
}

export function registerBoards(program: Command): Command {
  const boards = program
    .command("boards")
    .description("Inspect and update Boards")
    .hook("preAction", () => { resolveSpace(boards); });

  withJson(boards.command("create <path>")
    .description("Create a Board")
    .option("--title <title>", "Board title")
    .option("-i, --input <file>", "Board content JSON file; use - for stdin"))
    .action(async (path: string, options: JsonOptions & { title?: string; input?: string }) => {
      try {
        const content = options.input ? await readJsonObject(options.input) : {};
        if ("path" in content || "title" in content) {
          throw new Error("create input must not contain path or title; use the command argument and --title");
        }
        const input = { ...content, path, ...(options.title ? { title: options.title } : {}) } as BoardCreateInput;
        const result = await createClient().space(resolveSpace(boards)).boards.create(input);
        if (jsonRequested(options)) return outJson(result);
        ok(`Board created: ${result.board.id}`);
        showBoard(result);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("inspect <board-id>")
    .alias("get")
    .description("Inspect a Board")
    .option("--include <sections>", "Comma-separated nodes,effects,sequences,clips,playback")
    .option("--viewport <rect>", "Viewport as x,y,width,height"))
    .action(async (boardId: string, options: JsonOptions & { include?: string; viewport?: string }) => {
      try {
        const result = await createClient().space(resolveSpace(boards)).board(boardId).inspect({
          include: parseInspectSections(options.include),
          viewport: parseViewport(options.viewport),
        });
        if (jsonRequested(options)) return outJson(result);
        showBoard(result);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("capabilities <board-id>")
    .description("Show supported capabilities"))
    .action(async (boardId: string, options: JsonOptions) => {
      try {
        const result = await createClient().space(resolveSpace(boards)).board(boardId).capabilities();
        if (jsonRequested(options)) return outJson(result);
        table(result.capabilities.map((capability) => ({
          ...capability,
          renderers: capability.renderers?.join(", ") ?? "",
        })), [
          { key: "kind", label: "Kind" },
          { key: "id", label: "ID" },
          { key: "version", label: "Version" },
          { key: "renderers", label: "Renderers" },
          { key: "digest", label: "Digest" },
        ]);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  registerTransactionCommand(boards, "validate");
  registerTransactionCommand(boards, "apply");
  registerExportCommand(boards);

  withJson(boards.command("play <board-id> <sequence-id>")
    .description("Start shared playback")
    .option("--position <time>", "Initial position in milliseconds")
    .option("--time-scale <scale>", "Playback speed from 0 to 4")
    .option("--seed <seed>", "Deterministic playback seed")
    .option("--command-id <id>", "Idempotency command ID"))
    .action(async (boardId: string, sequenceId: string, options: PlaybackOptions & { position?: string; timeScale?: string; seed?: string }) => {
      try {
        const result = await createClient().space(resolveSpace(boards)).board(boardId).play({
          commandId: commandId(options),
          type: "play",
          sequenceId,
          shared: true,
          ...(options.position === undefined ? {} : { position: parseNumber(options.position, "position", { min: 0 }) }),
          ...(options.timeScale === undefined ? {} : { timeScale: parseNumber(options.timeScale, "timeScale", { min: Number.EPSILON, max: 4 }) }),
          ...(options.seed ? { seed: options.seed } : {}),
        });
        if (jsonRequested(options)) return outJson(result);
        showPlayback(result);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  const playbackAction = (type: "pause" | "stop") => async (
    boardId: string,
    playbackId: string,
    options: PlaybackOptions,
  ) => {
    try {
      const board = createClient().space(resolveSpace(boards)).board(boardId);
      const id = commandId(options);
      const result = type === "pause"
        ? await board.pause({ commandId: id, type: "pause", playbackId })
        : await board.stop({ commandId: id, type: "stop", playbackId });
      if (jsonRequested(options)) return outJson(result);
      showPlayback(result);
    } catch (cause) {
      handleHttp(cause);
    }
  };

  withJson(boards.command("pause <board-id> <playback-id>")
    .description("Pause playback")
    .option("--command-id <id>", "Idempotency command ID"))
    .action(playbackAction("pause"));

  withJson(boards.command("seek <board-id> <playback-id> <position>")
    .description("Seek playback")
    .option("--command-id <id>", "Idempotency command ID"))
    .action(async (boardId: string, playbackId: string, position: string, options: PlaybackOptions) => {
      try {
        const result = await createClient().space(resolveSpace(boards)).board(boardId).seek({
          commandId: commandId(options),
          type: "seek",
          playbackId,
          position: parseNumber(position, "position", { min: 0 }),
        });
        if (jsonRequested(options)) return outJson(result);
        showPlayback(result);
      } catch (cause) {
        handleHttp(cause);
      }
    });

  withJson(boards.command("stop <board-id> <playback-id>")
    .description("Stop playback")
    .option("--command-id <id>", "Idempotency command ID"))
    .action(playbackAction("stop"));

  withJson(boards.command("watch <board-id>")
    .description("Stream Board events"))
    .action((boardId: string, options: JsonOptions) => {
      try {
        const board = createRealtimeClient().space(resolveSpace(boards)).board(boardId);
        if (!jsonRequested(options)) process.stderr.write(`Listening for Board ${boardId} events...\n`);
        board.subscribe({
          event(event) {
            if (jsonRequested(options)) {
              process.stdout.write(`${JSON.stringify(event)}\n`);
              return;
            }
            if (event.type === "board.transaction.applied") {
              process.stdout.write(`version ${event.payload.version}  transaction ${event.payload.txId}  operations ${event.payload.operations.length}\n`);
            } else if (event.type === "board.playback.changed") {
              process.stdout.write(`${event.payload.status}  sequence ${event.payload.sequenceId}  position ${event.payload.position}\n`);
            } else {
              process.stdout.write(`awareness ${event.payload.actorName}  ${event.payload.update.type}\n`);
            }
          },
        });
      } catch (cause) {
        handleHttp(cause);
      }
    });

  return boards;
}
