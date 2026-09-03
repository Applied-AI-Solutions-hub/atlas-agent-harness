import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGoalProgress, validateChildGoal, validateGoalActivation } from "../src/goal-policy.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const base = {
  id: "goal-00000000-0000-4000-8000-000000000001",
  rootRequestDigest: digest,
  owner: "atlas",
  createdBy: "user",
  namespace: "business/applied-ai-solutions",
  privacyClass: "business-private",
  authority: {
    grantedBy: "user",
    selfDirected: true,
    allowedCapabilities: ["web.search", "report.draft"],
    allowedEffects: ["read", "research", "draft"],
  },
  budgets: { maxSteps: 12, maxChildren: 2, maxDepth: 2, maxWallSeconds: 600, maxSearches: 5, maxInputTokens: 20000, maxOutputTokens: 4000 },
  loopPolicy: { maxIdenticalActions: 2, maxNoProgressTicks: 3, maxReplans: 2, requireNewEvidence: true },
  status: "active",
  createdAt: "2026-09-02T12:00:00.000Z",
  deadlineAt: "2026-09-02T13:00:00.000Z",
  progress: { stepCount: 1 },
};

test("an agent cannot activate a root goal or self-authorize mutation", () => {
  const agentRoot = { ...base, createdBy: "atlas", status: "proposed", authority: { ...base.authority, grantedBy: "parent-goal", allowedEffects: ["read", "approved-mutation"] } };
  const result = validateGoalActivation(agentRoot, { now: new Date("2026-09-02T12:01:00.000Z") });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("; "), /requires a user-authorized parent/);
  assert.match(result.reasons.join("; "), /may not perform mutations/);
});

test("a valid child inherits and narrows authority", () => {
  const child = {
    ...base,
    id: "goal-00000000-0000-4000-8000-000000000002",
    parentGoalId: base.id,
    createdBy: "atlas",
    authority: { grantedBy: "parent-goal", selfDirected: true, allowedCapabilities: ["web.search"], allowedEffects: ["read", "research"] },
    budgets: { ...base.budgets, maxSteps: 5, maxChildren: 0, maxDepth: 1, maxWallSeconds: 300, maxSearches: 3, maxInputTokens: 10000, maxOutputTokens: 2000 },
    status: "proposed",
    deadlineAt: "2026-09-02T12:30:00.000Z",
  };
  assert.deepEqual(validateChildGoal(base, child, { parentDepth: 0, existingChildCount: 0 }), { allowed: true, reasons: [] });
});

test("a child cannot cross ownership, privacy, capability, or budget boundaries", () => {
  const child = {
    ...base,
    id: "goal-00000000-0000-4000-8000-000000000003",
    parentGoalId: base.id,
    owner: "sparky",
    privacyClass: "public",
    createdBy: "atlas",
    authority: { grantedBy: "parent-goal", selfDirected: true, allowedCapabilities: ["shell.root"], allowedEffects: ["approved-mutation"] },
    budgets: { ...base.budgets, maxSteps: 24 },
    status: "proposed",
  };
  const result = validateChildGoal(base, child);
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join("; "), /owner|privacy|capabilities|effects|budget/);
});

test("repeated actions force a replan and then block after the replan budget", () => {
  const ticks = [
    { actionFingerprint: "same", evidenceDigest: "one" },
    { actionFingerprint: "same", evidenceDigest: "two" },
  ];
  assert.equal(evaluateGoalProgress(base, ticks, { now: new Date("2026-09-02T12:02:00.000Z"), replansUsed: 0 }).action, "replan");
  const exhausted = evaluateGoalProgress(base, ticks, { now: new Date("2026-09-02T12:02:00.000Z"), replansUsed: 2 });
  assert.equal(exhausted.status, "blocked");
  assert.match(exhausted.reason, /replan budget exhausted/);
});

test("three ticks with unchanged evidence cannot continue", () => {
  const ticks = [
    { actionFingerprint: "one", evidenceDigest: "same" },
    { actionFingerprint: "two", evidenceDigest: "same" },
    { actionFingerprint: "three", evidenceDigest: "same" },
  ];
  const result = evaluateGoalProgress(base, ticks, { now: new Date("2026-09-02T12:02:00.000Z"), replansUsed: 2 });
  assert.equal(result.status, "blocked");
  assert.match(result.reason, /no new evidence/);
});

test("success, deadline, and step ceilings are terminal", () => {
  assert.equal(evaluateGoalProgress(base, [], { successCriteriaMet: true }).status, "succeeded");
  assert.equal(evaluateGoalProgress(base, [], { now: new Date("2026-09-02T13:01:00.000Z") }).status, "expired");
  const exhausted = { ...base, progress: { stepCount: base.budgets.maxSteps } };
  assert.equal(evaluateGoalProgress(exhausted, [], { now: new Date("2026-09-02T12:02:00.000Z") }).status, "blocked");
});
