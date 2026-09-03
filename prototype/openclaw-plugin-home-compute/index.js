import { buildJsonPluginConfigSchema, definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createStatusCommand } from "./status-command.js";

const configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabled: { type: "boolean", default: true }
  }
};

export default definePluginEntry({
  id: "atlas-home-compute",
  name: "Atlas Home Compute",
  description: "Bounded private compute capabilities for an approved Atlas home node.",
  configSchema: buildJsonPluginConfigSchema(configSchema),
  register(api) {
    const enabled = api.pluginConfig?.enabled !== false;
    api.registerNodeHostCommand(createStatusCommand({ enabled }));
    api.registerNodeInvokePolicy({
      commands: ["atlas.compute.status"],
      handle: async context => await context.invokeNode()
    });
  }
});
