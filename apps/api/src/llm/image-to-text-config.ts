import { createImageToTextConfigLoader } from "@cohub/infra/config-runtime/image-to-text";
import { config } from "../config.js";
import { redisCommandClient } from "../redis.js";

export const loadImageToTextConfig = createImageToTextConfigLoader({
  platformConfigRoot: config.platformConfigRoot,
  redis: redisCommandClient,
});
