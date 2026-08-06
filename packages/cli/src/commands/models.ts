import type { Command } from "commander";
import {
  filterDiscoverableGenerationModels,
  filterGenerationDeclarationsByPolicy,
  getAllowedGenerationModelIds,
  parseGenerationPolicyFromEnv,
  type PublicGenerationDeclaration,
} from "@neta-art/cohub";
import { createClient } from "../client.js";
import { table, json as outJson, jsonRequested, error, handleHttp, type Row } from "../output.js";

type MultimodalModelSummary = Pick<PublicGenerationDeclaration, "model" | "title" | "description">;

function toMultimodalModelSummary(model: PublicGenerationDeclaration): MultimodalModelSummary {
  return {
    model: model.model,
    ...(model.title ? { title: model.title } : {}),
    ...(model.description ? { description: model.description } : {}),
  };
}

function printSection(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(`\n${title}`);
  for (const line of lines) console.log(`  ${line}`);
}

type GenerationContentSpec = PublicGenerationDeclaration["content"]["input"][number];
type GenerationParameterSpec = NonNullable<PublicGenerationDeclaration["parameters"]>[string];

function formatContentSpec(spec: GenerationContentSpec): string {
  const details: string[] = [];
  const roles = (spec as GenerationContentSpec & { roles?: string[] }).roles;
  details.push(spec.required === false ? "optional" : "required");
  if (typeof spec.min === "number") details.push(`min ${spec.min}`);
  if (typeof spec.max === "number") details.push(`max ${spec.max}`);
  if (spec.sources?.length) details.push(`sources: ${spec.sources.join(", ")}`);
  if (roles?.length) details.push(`roles: ${roles.join(", ")}`);
  if (spec.merge) details.push(`merge: ${spec.merge}`);
  if (spec.description) details.push(spec.description);
  return `${spec.type}${details.length > 0 ? ` — ${details.join("; ")}` : ""}`;
}

function formatParameter(name: string, spec: GenerationParameterSpec): string[] {
  const lines = [`${name}`];
  const details: string[] = [`type: ${spec.type}`];
  if (spec.optional) details.push("optional");
  if ("default" in spec && spec.default !== undefined) details.push(`default: ${String(spec.default)}`);
  if ("min" in spec && typeof spec.min === "number") details.push(`min: ${spec.min}`);
  if ("max" in spec && typeof spec.max === "number") details.push(`max: ${spec.max}`);
  if ("enum" in spec && spec.enum?.length) details.push(`values: ${spec.enum.join(", ")}`);
  lines.push(`  ${details.join("; ")}`);
  if (spec.description) lines.push(`  ${spec.description}`);
  if ("examples" in spec && spec.examples?.length) lines.push(`  examples: ${spec.examples.map(String).join(", ")}`);
  return lines;
}

function printMultimodalModel(model: PublicGenerationDeclaration): void {
  console.log(model.title ?? model.model);
  printSection("Model", [model.model]);
  if (model.description) printSection("Description", [model.description]);

  printSection("Input", model.content.input.map(formatContentSpec));

  const parameterLines = Object.entries(model.parameters ?? {}).flatMap(([name, spec]) => formatParameter(name, spec));
  printSection("Parameters", parameterLines);

  const examples = model.examples ?? [];
  printSection("Examples", examples.map((example, index) => {
    const title = example.title ? `${example.title}: ` : "";
    const prompt = example.request.content.find((block) => block.type === "text")?.text;
    return `${index + 1}. ${title}${prompt ? `"${prompt}"` : example.request.model}`;
  }));
}

export function registerModels(program: Command): void {
  const cmd = program
    .command("models")
    .description("List available LLM and multimodal models")
    .addHelpText("after", `

Examples:
  cohub models ls
  cohub models ls --model-type multimodal
  cohub models ls --model-type multimodal --json
  cohub models show <model>
  cohub models show <model> --json
`);

  cmd
    .command("ls")
    .alias("list")
    .description("List available models")
    .option("--model-type <type>", "Model type: llm | multimodal", "llm")
    .option("--json", "Output as JSON")
    .action(async (opts: { modelType?: string; json?: boolean }) => {
      const client = createClient();
      try {
        if (opts.modelType === "multimodal") {
          const response = await client.models.listMultimodal();
          const policy = parseGenerationPolicyFromEnv(process.env);
          const allowedModelIds = getAllowedGenerationModelIds(policy);
          const filtered = filterGenerationDeclarationsByPolicy(response.models, policy);
          const models = filterDiscoverableGenerationModels(filtered, {
            includeModelIds: allowedModelIds ?? undefined,
          }).map(toMultimodalModelSummary);
          if (jsonRequested(opts)) return outJson({ models });
          table(models as unknown as Row[], [
            { key: "model", label: "Model" },
            { key: "title", label: "Title" },
            { key: "description", label: "Description" },
          ]);
          return;
        }

        if (opts.modelType && opts.modelType !== "llm") {
          return error("Invalid model type", "Use --model-type llm or --model-type multimodal");
        }

        const catalog = await client.models.list();
        if (jsonRequested(opts)) return outJson(catalog);

        // catalog is Record<provider, ModelCatalogEntry[]>
        for (const [provider, entries] of Object.entries(catalog)) {
          console.log(`\n  ${provider}`);
          console.log(`  ${"─".repeat(provider.length)}`);
          table(entries as Row[], [
            { key: "id", label: "ID" },
            { key: "provider", label: "Provider" },
          ]);
        }
      } catch (e: unknown) {
        handleHttp(e);
      }
    });

  cmd
    .command("show")
    .description("Show full multimodal model details")
    .argument("<model>", "Multimodal model ID")
    .option("--json", "Output as JSON")
    .action(async (modelId: string, opts: { json?: boolean }) => {
      const client = createClient();
      try {
        const response = await client.models.listMultimodal();
        const models = filterGenerationDeclarationsByPolicy(response.models, parseGenerationPolicyFromEnv(process.env));
        const model = models.find((item) => item.model === modelId);
        if (!model) {
          return error("Model not found", `No multimodal model named ${modelId}`);
        }
        if (jsonRequested(opts)) return outJson(model);
        printMultimodalModel(model);
      } catch (e: unknown) {
        handleHttp(e);
      }
    });
}
