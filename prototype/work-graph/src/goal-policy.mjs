const TERMINAL_STATUSES = new Set(["succeeded", "blocked", "failed", "cancelled", "expired"]);
const SELF_DIRECTED_EFFECTS = new Set(["read", "research", "draft", "index-proposal", "current-channel-progress"]);

function isSubset(child = [], parent = []) {
  const allowed = new Set(parent);
  return child.every((value) => allowed.has(value));
}

function consecutiveMatching(items, field) {
  if (!items.length) return 0;
  const expected = items.at(-1)?.[field];
  if (!expected) return 0;
  let count = 0;
  for (let index = items.length - 1; index >= 0 && items[index]?.[field] === expected; index -= 1) count += 1;
  return count;
}

function exceedsChildBudget(child, parent) {
  return Object.entries(child || {}).some(([name, value]) => Number(value) > Number(parent?.[name] ?? -1));
}

export function validateGoalActivation(goal, { now = new Date() } = {}) {
  const reasons = [];
  if (goal.status !== "proposed") reasons.push("only a proposed goal can be activated");
  if (new Date(goal.deadlineAt).getTime() <= now.getTime()) reasons.push("goal deadline has expired");
  if (goal.createdBy !== "user" && !goal.parentGoalId) reasons.push("an agent-created goal requires a user-authorized parent");
  if (goal.createdBy !== "user" && goal.authority?.grantedBy !== "parent-goal") reasons.push("agent-created authority must be inherited from a parent goal");
  if (goal.createdBy !== "user" && goal.authority?.selfDirected !== true) reasons.push("the inherited authority does not permit self-directed work");
  if (goal.createdBy !== "user" && !isSubset(goal.authority?.allowedEffects, SELF_DIRECTED_EFFECTS)) reasons.push("self-directed goals may not perform mutations");
  return { allowed: reasons.length === 0, reasons };
}

export function validateChildGoal(parent, child, { parentDepth = 0, existingChildCount = 0 } = {}) {
  const reasons = [];
  if (TERMINAL_STATUSES.has(parent.status)) reasons.push("a terminal parent cannot create a child goal");
  if (child.parentGoalId !== parent.id) reasons.push("child does not reference this parent goal");
  if (child.rootRequestDigest !== parent.rootRequestDigest) reasons.push("child changed the root request");
  if (child.owner !== parent.owner) reasons.push("child changed the accountable owner");
  if (child.namespace !== parent.namespace) reasons.push("child changed the namespace");
  if (child.privacyClass !== parent.privacyClass) reasons.push("child changed the privacy boundary");
  if (new Date(child.deadlineAt).getTime() > new Date(parent.deadlineAt).getTime()) reasons.push("child deadline exceeds the parent deadline");
  if (!isSubset(child.authority?.allowedCapabilities, parent.authority?.allowedCapabilities)) reasons.push("child widened allowed capabilities");
  if (!isSubset(child.authority?.allowedEffects, parent.authority?.allowedEffects)) reasons.push("child widened allowed effects");
  if (exceedsChildBudget(child.budgets, parent.budgets)) reasons.push("child widened a budget");
  if (parentDepth + 1 > parent.budgets.maxDepth) reasons.push("maximum child depth reached");
  if (existingChildCount >= parent.budgets.maxChildren) reasons.push("maximum child count reached");
  if (child.authority?.grantedBy !== "parent-goal") reasons.push("child authority must identify the parent goal as its grant");
  return { allowed: reasons.length === 0, reasons };
}

export function evaluateGoalProgress(goal, ticks, { now = new Date(), successCriteriaMet = false, replansUsed = 0 } = {}) {
  if (successCriteriaMet) return { action: "succeed", status: "succeeded", reason: "all success criteria are verified" };
  if (TERMINAL_STATUSES.has(goal.status)) return { action: "stop", status: goal.status, reason: "goal is already terminal" };
  if (new Date(goal.deadlineAt).getTime() <= now.getTime()) return { action: "stop", status: "expired", reason: "goal deadline expired" };
  if ((goal.progress?.stepCount || 0) >= goal.budgets.maxSteps) return { action: "stop", status: "blocked", reason: "step budget exhausted" };

  const identicalActions = consecutiveMatching(ticks, "actionFingerprint");
  const noProgressTicks = consecutiveMatching(ticks, "evidenceDigest");
  const repeatedAction = identicalActions >= goal.loopPolicy.maxIdenticalActions;
  const stalledEvidence = noProgressTicks >= goal.loopPolicy.maxNoProgressTicks;
  if (repeatedAction || stalledEvidence) {
    const reason = repeatedAction ? "identical action limit reached" : "no new evidence limit reached";
    if (replansUsed < goal.loopPolicy.maxReplans) return { action: "replan", status: "active", reason };
    return { action: "stop", status: "blocked", reason: `${reason}; replan budget exhausted` };
  }
  return { action: "continue", status: "active", reason: "new evidence and budget remain" };
}

export const goalPolicyConstants = Object.freeze({
  selfDirectedEffects: [...SELF_DIRECTED_EFFECTS],
  terminalStatuses: [...TERMINAL_STATUSES],
});
