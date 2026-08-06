import { createImageToTextConfigLoader } from "@cohub/infra/config-runtime/image-to-text";
import { redis } from "../redis.js";
import { getAgentConfigRoot } from "./paths.js";

export const loadImageToTextConfig = createImageToTextConfigLoader({
  platformConfigRoot: getAgentConfigRoot(),
  redis,
});
