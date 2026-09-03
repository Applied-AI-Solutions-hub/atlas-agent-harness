import test from "node:test";
import assert from "node:assert/strict";
import { validateRegistry, routeCapability, evaluateGate } from "./nvidia-capabilities.mjs";

const registry = {
  schemaVersion: 1,
  provider: { id: "nvidia" },
  policies: { allowUnknownAccess: false },
  models: [{
    id: "provider/model",
    access: "hosted",
    lifecycle: "validated",
    capabilities: ["chat.fast"],
    routes: { production: true, priority: 10 }
  }],
  routes: [{ capability: "chat.fast", qualityGate: "gate", candidates: ["provider/model"] }]
};

test("accepts a valid registry", () => assert.deepEqual(validateRegistry(registry), []));

test("routes only validated production models", () => {
  assert.equal(routeCapability(registry, "chat.fast").model.id, "provider/model");
});

test("fails closed when only a candidate exists", () => {
  const candidate = structuredClone(registry);
  candidate.models[0].lifecycle = "candidate";
  candidate.models[0].routes.production = false;
  assert.throws(() => routeCapability(candidate, "chat.fast"), /No eligible model/);
});

test("rejects production promotion without validation", () => {
  const invalid = structuredClone(registry);
  invalid.models[0].lifecycle = "candidate";
  assert.match(validateRegistry(invalid).join("\n"), /cannot be production before validation/);
});

test("requires every quality metric to pass", () => {
  const gate = { id: "vision", metrics: {
    accuracy: { operator: ">=", value: 0.9 },
    p95LatencyMs: { operator: "<=", value: 20000 }
  }};
  assert.equal(evaluateGate(gate, { accuracy: 0.95, p95LatencyMs: 15000 }).pass, true);
  assert.equal(evaluateGate(gate, { accuracy: 0.95, p95LatencyMs: 25000 }).pass, false);
  assert.equal(evaluateGate(gate, { accuracy: 0.95 }).pass, false);
});

test("malformed registries return errors instead of crashing", () => {
  const malformed = { schemaVersion: 1, provider: { id: "nvidia" }, routes: [
    { capability: "vision.general", qualityGate: "vision", candidates: ["missing"] }
  ]};
  assert.doesNotThrow(() => validateRegistry(malformed));
  assert.ok(validateRegistry(malformed).length > 0);
});

test("rejects duplicate model identifiers and route capabilities", () => {
  const duplicate = structuredClone(registry);
  duplicate.models.push(structuredClone(duplicate.models[0]));
  duplicate.routes.push(structuredClone(duplicate.routes[0]));
  const errors = validateRegistry(duplicate).join("\n");
  assert.match(errors, /duplicated/);
});

test("orders validated fallbacks by explicit priority", () => {
  const routed = structuredClone(registry);
  routed.models.push({ ...structuredClone(routed.models[0]), id: "provider/fallback", routes: { production: true, priority: 1 } });
  routed.routes[0].candidates.push("provider/fallback");
  const result = routeCapability(routed, "chat.fast");
  assert.equal(result.model.id, "provider/model");
  assert.equal(result.fallbacks[0].id, "provider/fallback");
});
