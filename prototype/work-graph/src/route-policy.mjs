import { randomUUID } from "node:crypto";

function supports(worker, request) {
  if (worker.state !== "healthy") return false;
  if (worker.cooldownUntil && Date.parse(worker.cooldownUntil) > Date.parse(request.now)) return false;
  if (!worker.capabilities?.includes(request.requestedCapability)) return false;
  if (!worker.privacyClasses?.includes(request.privacyClass)) return false;
  if (worker.credentialOwner && worker.credentialOwner !== request.owner) return false;
  if (request.preferredExecutors?.length && !request.preferredExecutors.includes(worker.id) && !request.preferredExecutors.includes(worker.kind)) return false;
  const remainingSeconds = (Date.parse(request.deadlineAt) - Date.parse(request.now)) / 1_000;
  return (worker.estimatedWaitSeconds || 0) + (worker.maxWallSeconds || request.maxWallSeconds) <= remainingSeconds;
}

function compareWorkers(left, right) {
  const quality = Number(right.qualityScore || 0) - Number(left.qualityScore || 0);
  if (quality !== 0) return quality;
  const wait = Number(left.estimatedWaitSeconds || 0) - Number(right.estimatedWaitSeconds || 0);
  if (wait !== 0) return wait;
  const latency = Number(left.warmP95Seconds ?? Number.POSITIVE_INFINITY) - Number(right.warmP95Seconds ?? Number.POSITIVE_INFINITY);
  if (latency !== 0) return latency;
  return left.id.localeCompare(right.id);
}

function explanation(worker, request) {
  const parts = [
    `${worker.id} is healthy`,
    `admits ${request.requestedCapability}`,
    `accepts ${request.privacyClass}`,
  ];
  if (worker.credentialOwner) parts.push(`uses only ${worker.credentialOwner}'s credential`);
  else parts.push("requires no provider credential");
  if (Number.isFinite(worker.qualityScore)) parts.push(`quality score ${worker.qualityScore}`);
  if (Number.isFinite(worker.warmP95Seconds)) parts.push(`measured warm p95 ${worker.warmP95Seconds}s`);
  return `${parts.join(", ")}.`;
}

export function resolveCapabilityRoute(request, registry, { routeId = `route-${randomUUID()}`, now = new Date() } = {}) {
  const at = now.toISOString();
  const normalized = { maxWallSeconds: 120, ...request, now: at };
  if (Date.parse(normalized.deadlineAt) <= now.getTime()) {
    return { schemaVersion: 1, id: routeId, owner: request.owner, namespace: request.namespace, privacyClass: request.privacyClass, requestedCapability: request.requestedCapability, createdAt: at, decision: "unavailable", reason: "The route deadline has already expired.", steps: [] };
  }

  const eligible = registry.filter((worker) => supports(worker, normalized)).sort(compareWorkers);
  if (!eligible.length) {
    return { schemaVersion: 1, id: routeId, owner: request.owner, namespace: request.namespace, privacyClass: request.privacyClass, requestedCapability: request.requestedCapability, createdAt: at, decision: "unavailable", reason: "No healthy worker satisfies capability, privacy, credential-owner, preference, cooldown, and deadline policy.", steps: [] };
  }

  const selected = eligible[0];
  const needsApproval = selected.requiresApproval === true && request.approved !== true;
  return {
    schemaVersion: 1,
    id: routeId,
    owner: request.owner,
    namespace: request.namespace,
    privacyClass: request.privacyClass,
    requestedCapability: request.requestedCapability,
    createdAt: at,
    decision: needsApproval ? "needs-approval" : "executable",
    reason: needsApproval ? `${selected.id} is eligible but its external effect requires explicit approval.` : explanation(selected, normalized),
    steps: [{
      id: "step-execute",
      dependsOn: [],
      capability: request.requestedCapability,
      executor: selected.id,
      why: explanation(selected, normalized),
      expectedArtifact: request.expectedArtifact || "validated result receipt",
      maxWallSeconds: Math.min(normalized.maxWallSeconds, selected.maxWallSeconds || normalized.maxWallSeconds),
      ...(eligible[1] ? { fallbackExecutor: eligible[1].id } : {}),
    }],
  };
}
