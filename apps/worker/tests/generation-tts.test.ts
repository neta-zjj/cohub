import assert from "node:assert/strict";
import { test } from "node:test";
import { createGenerationClient, getBuiltinGenerationModel } from "@neta-art/generation";

function generationClient(model: string) {
  const declaration = getBuiltinGenerationModel(model);
  assert.ok(declaration);
  return {
    declaration,
    client: createGenerationClient({
      models: [declaration],
      includeBuiltinModels: false,
    }),
  };
}

test("validates the documented Qwen voice design request", () => {
  const { client, declaration } = generationClient("qwen-audio-3.0-tts-plus");
  const resolved = client.validate({
    model: declaration.model,
    content: [{ type: "text", text: "Welcome to Cohub. This voice was created from a description." }],
    meta: { voice_prompt: "A calm, clear male narrator with a warm tone" },
  });

  assert.equal(resolved.meta.voice_prompt, "A calm, clear male narrator with a warm tone");
});

test("validates the documented Higgs public URL clone request", () => {
  const { client, declaration } = generationClient("higgs-tts");
  const resolved = client.validate({
    model: declaration.model,
    content: [
      { type: "text", text: "Welcome to Cohub. This voice follows the reference recording." },
      { type: "audio", source: { type: "url", url: "https://example.com/reference.mp3" } },
    ],
  });

  assert.equal(resolved.request.content[1]?.type, "audio");
});
