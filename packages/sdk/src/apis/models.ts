import type { HttpTransport } from "../transport.js";
import type {
  ListGenerationModelsResponse,
  ModelCatalogEntry,
  ModelStatusResponse,
} from "../types.js";

export const MULTIMODAL_MODEL_TYPE = "multimodal";

export type ModelsCatalog = Record<string, ModelCatalogEntry[]>;

export class ModelsApi {
  constructor(private readonly transport: HttpTransport) {}

  async list() {
    return this.transport.request<ModelsCatalog>(
      "/api/models",
    );
  }

  async listMultimodal(): Promise<ListGenerationModelsResponse> {
    return this.transport.request<ListGenerationModelsResponse>(
      `/api/models?modelType=${MULTIMODAL_MODEL_TYPE}`,
    );
  }

  async status(): Promise<ModelStatusResponse> {
    return this.transport.request<ModelStatusResponse>("/api/models/status");
  }
}
