import { Type } from "typebox";
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { createMemoryClient } from "./client.js";

const namespaceArray = Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 4 }));

function asToolResult(details, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
    isError
  };
}

export default defineToolPlugin({
  id: "atlas-memory",
  name: "Atlas Memory",
  description: "Retrieve small, source-linked evidence packets from shared memory only when needed.",
  configSchema: Type.Object({
    baseUrl: Type.Optional(Type.String({ default: "http://127.0.0.1:8791" })),
    tokenFile: Type.Optional(Type.String({ default: "/home/openclaw/.config/atlas-memory/tokens/atlas" })),
    namespaces: Type.Optional(Type.Array(Type.String(), { default: ["business/applied-ai-solutions", "agent/atlas", "public"] })),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 5000, default: 1500 })),
    maxEvidenceTokens: Type.Optional(Type.Integer({ minimum: 128, maximum: 2000, default: 1200 }))
  }, { additionalProperties: false }),
  tools: tool => [
    tool({
      name: "graph_status",
      label: "Graph Status",
      description: "Check whether the shared memory service is reachable. Does not retrieve or write memory.",
      optional: true,
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_params, config, context) {
        context.signal?.throwIfAborted();
        try { return asToolResult(await createMemoryClient(config).health()); }
        catch (error) { return asToolResult({ ok: false, error: String(error?.message || error) }, true); }
      }
    }),
    tool({
      name: "graph_recall",
      label: "Graph Recall",
      description: "Retrieve a bounded evidence packet for relevant prior facts, decisions, documents, or relationships. Use live web search instead for current facts. This tool never writes memory.",
      optional: true,
      parameters: Type.Object({
        query: Type.String({ minLength: 2, maxLength: 500 }),
        namespaces: namespaceArray,
        topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 8, default: 5 })),
        tokenBudget: Type.Optional(Type.Integer({ minimum: 128, maximum: 2000, default: 1200 })),
        includeGraph: Type.Optional(Type.Boolean({ default: true }))
      }, { additionalProperties: false }),
      async execute(params, config, context) {
        context.signal?.throwIfAborted();
        try {
          const details = await createMemoryClient(config).search({
            query: params.query,
            requestedNamespaces: params.namespaces,
            topK: params.topK,
            tokenBudget: params.tokenBudget,
            includeGraph: params.includeGraph
          });
          return asToolResult(details);
        } catch (error) {
          return asToolResult({ ok: false, error: String(error?.message || error) }, true);
        }
      }
    })
  ]
});
