#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRegistry = resolve(here, "../nvidia/capability-registry.json");
const defaultGates = resolve(here, "../nvidia/evaluation-gates.json");
const registryPath = process.env.NVIDIA_CAPABILITY_REGISTRY || defaultRegistry;

function fail(message, details = []) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function validateRegistry(registry) {
  const errors = [];
  const models = Array.isArray(registry?.models) ? registry.models : [];
  const routes = Array.isArray(registry?.routes) ? registry.routes : [];
  if (registry?.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (!registry?.provider?.id) errors.push("provider.id is required");
  if (!Array.isArray(registry?.models) || registry.models.length === 0) errors.push("models must be non-empty");
  if (!Array.isArray(registry?.routes)) errors.push("routes must be an array");

  const ids = new Set();
  for (const [index, model] of models.entries()) {
    const at = `models[${index}]`;
    if (!model.id) errors.push(`${at}.id is required`);
    if (ids.has(model.id)) errors.push(`${at}.id is duplicated: ${model.id}`);
    ids.add(model.id);
    if (!["hosted", "self-hosted", "unknown"].includes(model.access)) errors.push(`${at}.access is invalid`);
    if (!["candidate", "evaluating", "validated", "retired", "blocked"].includes(model.lifecycle)) errors.push(`${at}.lifecycle is invalid`);
    if (!Array.isArray(model.capabilities) || model.capabilities.length === 0) errors.push(`${at}.capabilities must be non-empty`);
    if (model.routes?.production && model.lifecycle !== "validated") errors.push(`${at} cannot be production before validation`);
    if (model.routes?.production && model.access === "unknown") errors.push(`${at} cannot be production with unknown access`);
  }

  const capabilities = new Set();
  for (const [index, route] of routes.entries()) {
    const at = `routes[${index}]`;
    if (!route.capability) errors.push(`${at}.capability is required`);
    if (capabilities.has(route.capability)) errors.push(`${at}.capability is duplicated`);
    capabilities.add(route.capability);
    if (!route.qualityGate) errors.push(`${at}.qualityGate is required`);
    if (!Array.isArray(route.candidates) || route.candidates.length === 0) errors.push(`${at}.candidates must be non-empty`);
    for (const id of route.candidates || []) {
      const model = models.find(candidate => candidate.id === id);
      if (!model) errors.push(`${at} references unknown model ${id}`);
      else if (!model.capabilities.includes(route.capability)) errors.push(`${id} does not declare ${route.capability}`);
    }
  }
  return errors;
}

function routeCapability(registry, capability, { allowCandidate = false } = {}) {
  const route = registry.routes.find(item => item.capability === capability);
  if (!route) fail(`No route exists for capability: ${capability}`);
  const eligible = route.candidates
    .map(id => registry.models.find(model => model.id === id))
    .filter(Boolean)
    .filter(model => !["retired", "blocked"].includes(model.lifecycle))
    .filter(model => model.access !== "unknown" || registry.policies.allowUnknownAccess)
    .filter(model => allowCandidate || (model.lifecycle === "validated" && model.routes.production))
    .sort((a, b) => (b.routes?.priority || 0) - (a.routes?.priority || 0));
  if (eligible.length === 0) fail(`No eligible model passed routing policy for: ${capability}`);
  return { capability, qualityGate: route.qualityGate, model: eligible[0], fallbacks: eligible.slice(1) };
}

function evaluateGate(gate, metrics) {
  const results = Object.entries(gate.metrics).map(([name, requirement]) => {
    const actual = metrics[name];
    const pass = typeof actual === "number" && (requirement.operator === ">="
      ? actual >= requirement.value
      : requirement.operator === "<=" && actual <= requirement.value);
    return { name, actual: actual ?? null, ...requirement, pass };
  });
  return { gate: gate.id, pass: results.every(result => result.pass), results };
}

async function probeHosted(registry, modelId) {
  const model = registry.models.find(item => item.id === modelId);
  if (!model) fail(`Unknown model: ${modelId}`);
  if (model.access !== "hosted") fail(`Model is not marked hosted: ${modelId}`);
  const key = process.env[registry.provider.credentialRef];
  if (!key) fail(`Set ${registry.provider.credentialRef} through a protected runtime before probing`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), registry.policies.defaultTimeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${registry.provider.hostedBaseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: "Reply with exactly CAPABILITY_OK" }], max_tokens: 16, stream: false })
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, model: model.id, latencyMs: Math.round(performance.now() - started), output: body?.choices?.[0]?.message?.content || null };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const [command = "validate", argument, ...flags] = process.argv.slice(2);
  const registry = await loadJson(registryPath);
  const errors = validateRegistry(registry);
  if (errors.length) fail("Registry validation failed", errors);

  if (command === "validate") return { ok: true, registry: registryPath, models: registry.models.length, routes: registry.routes.length };
  if (command === "list") return registry.models.map(({ id, access, lifecycle, capabilities, routes }) => ({ id, access, lifecycle, capabilities, production: Boolean(routes?.production) }));
  if (command === "route") return routeCapability(registry, argument, { allowCandidate: flags.includes("--allow-candidate") });
  if (command === "probe") return probeHosted(registry, argument);
  if (command === "gate") {
    const metricsPath = flags[0];
    if (!argument || !metricsPath) fail("Usage: gate <gate-id> <metrics.json>");
    const gates = await loadJson(process.env.NVIDIA_EVALUATION_GATES || defaultGates);
    const gate = gates.gates.find(item => item.id === argument);
    if (!gate) fail(`Unknown evaluation gate: ${argument}`);
    const result = evaluateGate(gate, await loadJson(resolve(metricsPath)));
    if (!result.pass) process.exitCode = 2;
    return result;
  }
  fail(`Unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await main(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message, details: error.details || [] }, null, 2));
    process.exitCode = 1;
  }
}

export { validateRegistry, routeCapability, evaluateGate };
