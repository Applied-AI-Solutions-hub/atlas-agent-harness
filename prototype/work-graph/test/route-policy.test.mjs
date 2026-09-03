import test from "node:test";
import assert from "node:assert/strict";
import { resolveCapabilityRoute } from "../src/route-policy.mjs";

const request = {
  owner: "atlas",
  namespace: "business/applied-ai-solutions",
  privacyClass: "business-private",
  requestedCapability: "gpu.nemotron.generate",
  deadlineAt: "2026-09-02T13:00:00.000Z",
  maxWallSeconds: 120,
};
const routeOptions = { routeId: "route-00000000-0000-4000-8000-000000000001", now: new Date("2026-09-02T12:00:00.000Z") };

test("routes deterministically to the strongest eligible privacy-safe worker", () => {
  const registry = [
    { id: "hosted-other-key", kind: "hosted", state: "healthy", credentialOwner: "sparky", capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass], qualityScore: 99, maxWallSeconds: 60 },
    { id: "home-gpu", kind: "home-gpu", state: "healthy", credentialOwner: null, capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass], qualityScore: 82, warmP95Seconds: 0.83, maxWallSeconds: 120 },
    { id: "slow-gpu", kind: "home-gpu", state: "healthy", credentialOwner: null, capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass], qualityScore: 70, warmP95Seconds: 2, maxWallSeconds: 120 },
  ];
  const route = resolveCapabilityRoute(request, registry, routeOptions);
  assert.equal(route.decision, "executable");
  assert.equal(route.steps[0].executor, "home-gpu");
  assert.equal(route.steps[0].fallbackExecutor, "slow-gpu");
  assert.match(route.reason, /requires no provider credential/);
});

test("returns unavailable instead of inventing an executor", () => {
  const registry = [{ id: "offline", state: "offline", credentialOwner: null, capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass] }];
  const route = resolveCapabilityRoute(request, registry, routeOptions);
  assert.equal(route.decision, "unavailable");
  assert.deepEqual(route.steps, []);
});

test("makes approval an explicit route decision", () => {
  const registry = [{ id: "external-writer", state: "healthy", credentialOwner: "atlas", requiresApproval: true, capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass], maxWallSeconds: 120 }];
  const route = resolveCapabilityRoute(request, registry, routeOptions);
  assert.equal(route.decision, "needs-approval");
  assert.equal(route.steps[0].executor, "external-writer");
});

test("rejects a route that cannot finish before its deadline", () => {
  const registry = [{ id: "busy-gpu", state: "healthy", credentialOwner: null, capabilities: [request.requestedCapability], privacyClasses: [request.privacyClass], estimatedWaitSeconds: 40, maxWallSeconds: 30 }];
  const nearDeadline = { ...request, deadlineAt: "2026-09-02T12:01:00.000Z" };
  assert.equal(resolveCapabilityRoute(nearDeadline, registry, routeOptions).decision, "unavailable");
});
