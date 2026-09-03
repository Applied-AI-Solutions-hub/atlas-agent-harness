import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { createWorkGraphClient } from "./client.js";

export default defineToolPlugin({
  id: "work-graph",
  name: "Applied AI Work Graph",
  description: "Explicit asynchronous delegation to the measured Home GPU worker.",
  configSchema: Type.Object({
    baseUrl: Type.Optional(Type.String({ default: "http://127.0.0.1:8792" })),
    tokenFile: Type.Optional(Type.String({ default: "/home/openclaw/.config/atlas-memory/tokens/atlas" })),
    namespace: Type.Optional(Type.String({ default: "business/applied-ai-solutions" })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 5000, default: 1500 })),
  }, { additionalProperties: false }),
  tools: (tool) => [
    tool({
      name: "work_submit",
      label: "Submit Background Work",
      description: "Submit substantial draft generation to the Home GPU and return immediately with a job ID. Do not use for ordinary chat or simple one-tool answers.",
      optional: true,
      parameters: Type.Object({
        operation: Type.String({ minLength: 1, maxLength: 80 }),
        prompt: Type.String({ minLength: 1, maxLength: 12000 }),
        privacyClass: Type.Optional(Type.Union([Type.Literal("public"), Type.Literal("business-private")], { default: "business-private" })),
        maxOutputTokens: Type.Optional(Type.Integer({ minimum: 32, maximum: 512, default: 256 })),
        deadlineSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 600, default: 180 })),
        requireJson: Type.Optional(Type.Boolean({ default: false })),
      }, { additionalProperties: false }),
      async execute(params, config, context) {
        context.signal?.throwIfAborted();
        return createWorkGraphClient(config).submit({ ...params, think: false });
      },
    }),
    tool({
      name: "work_status",
      label: "Background Work Status",
      description: "Read the current state, validated receipt, or completed artifact for one owned background job.",
      optional: true,
      parameters: Type.Object({
        jobId: Type.String({ minLength: 1, maxLength: 128 }),
        includeResult: Type.Optional(Type.Boolean({ default: false })),
      }, { additionalProperties: false }),
      async execute(params, config, context) {
        context.signal?.throwIfAborted();
        return createWorkGraphClient(config).status(params.jobId, params.includeResult);
      },
    }),
  ],
});
