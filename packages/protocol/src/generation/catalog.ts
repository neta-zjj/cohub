import type { GenerationModelDeclaration } from "@neta-art/generation";

export type GenerationModelVisibility = Pick<GenerationModelDeclaration, "model" | "hidden">;

export function isGenerationModelHidden(model: GenerationModelVisibility): boolean {
  return model.hidden === true;
}

export function filterDiscoverableGenerationModels<T extends GenerationModelVisibility>(
  models: readonly T[],
  options: { includeModelIds?: Iterable<string> } = {},
): T[] {
  const includeModelIds = new Set(options.includeModelIds);
  return models.filter((model) => !isGenerationModelHidden(model) || includeModelIds.has(model.model));
}
