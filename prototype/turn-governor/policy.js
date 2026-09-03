const LANE_POLICIES = Object.freeze({
  chat: Object.freeze({
    allowedTools: [],
    maxToolAttempts: 0,
    maxModelCalls: 1,
    maxFailures: 0,
    maxNoProgress: 0,
    deadlineMs: 15_000,
    maxInputTokensPerCall: 12_000,
    maxOutputTokensPerCall: 800,
  }),
  recall: Object.freeze({
    allowedTools: ["graph_recall", "graph_status"],
    maxToolAttempts: 1,
    maxModelCalls: 2,
    maxFailures: 1,
    maxNoProgress: 1,
    deadlineMs: 20_000,
    maxInputTokensPerCall: 12_000,
    maxOutputTokensPerCall: 800,
  }),
  research: Object.freeze({
    allowedTools: ["research_batch"],
    maxToolAttempts: 1,
    maxModelCalls: 2,
    maxFailures: 1,
    maxNoProgress: 1,
    deadlineMs: 75_000,
    maxInputTokensPerCall: 24_000,
    maxOutputTokensPerCall: 1_800,
  }),
  work: Object.freeze({
    allowedTools: ["work_submit"],
    maxToolAttempts: 1,
    maxModelCalls: 2,
    maxFailures: 1,
    maxNoProgress: 1,
    deadlineMs: 20_000,
    maxInputTokensPerCall: 12_000,
    maxOutputTokensPerCall: 800,
  }),
});

const NON_SEMANTIC_ARGUMENTS = new Set([
  "count",
  "limit",
  "maxResults",
  "max_results",
  "topK",
  "top_k",
  "tokenBudget",
  "token_budget",
]);

function clonePolicy(lane, overrides) {
  const base = LANE_POLICIES[lane];
  if (!base) throw new Error(`Unknown turn lane: ${lane}`);
  return {
    ...base,
    ...overrides,
    allowedTools: [...(overrides.allowedTools ?? base.allowedTools)],
  };
}

function moveToFinalization(state, reason) {
  if (state.phase === "active") {
    state.phase = "finalizing";
    state.stopReason = reason;
  }
}

function failClosed(state, reason) {
  state.phase = "aborted";
  state.stopReason = reason;
  return { allow: false, abort: true, reason };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !NON_SEMANTIC_ARGUMENTS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : value;
}

export function fingerprintToolCall(toolName, args) {
  return `${String(toolName).trim().toLowerCase()}:${JSON.stringify(stableValue(args ?? {}))}`;
}

export function createTurnGovernor(lane, overrides = {}, now = Date.now()) {
  const policy = clonePolicy(lane, overrides);
  return {
    lane,
    policy,
    phase: policy.maxToolAttempts === 0 ? "finalizing" : "active",
    stopReason: policy.maxToolAttempts === 0 ? "lane-has-no-tools" : undefined,
    startedAt: now,
    finalModelCallStarted: false,
    modelCalls: 0,
    toolAttempts: 0,
    toolExecutions: 0,
    failures: 0,
    consecutiveNoProgress: 0,
    inputTokens: 0,
    outputTokens: 0,
    evidenceDigests: new Set(),
    fingerprints: new Map(),
  };
}

export function prepareModelRequest(state, request, now = Date.now(), metadata = {}) {
  if (state.phase === "complete" || state.phase === "aborted") {
    throw new Error(`Turn is terminal: ${state.phase}`);
  }
  if (now - state.startedAt >= state.policy.deadlineMs && state.phase === "active") {
    moveToFinalization(state, "deadline-exhausted");
  }

  if (state.phase === "finalizing" && state.finalModelCallStarted) {
    failClosed(state, "terminal-finalization-already-used");
    throw new Error("Terminal finalization may run only once");
  }

  if (
    Number.isFinite(metadata.estimatedInputTokens) &&
    metadata.estimatedInputTokens > state.policy.maxInputTokensPerCall
  ) {
    failClosed(state, "input-token-budget-exhausted");
    throw new Error("Estimated input exceeds the lane token budget");
  }

  if (state.modelCalls >= state.policy.maxModelCalls) {
    failClosed(state, "model-call-budget-exhausted");
    throw new Error("Model-call budget exhausted");
  }

  const suppliedTools = Array.isArray(request?.tools) ? request.tools : [];

  if (state.phase === "finalizing") {
    state.modelCalls += 1;
    state.finalModelCallStarted = true;
    const {
      tools: _tools,
      tool_choice: _toolChoice,
      parallel_tool_calls: _parallelToolCalls,
      ...withoutTools
    } = request ?? {};
    return {
      terminal: true,
      allowedTools: [],
      request: {
        ...withoutTools,
        max_tokens: Math.min(
          Number.isFinite(withoutTools.max_tokens)
            ? withoutTools.max_tokens
            : state.policy.maxOutputTokensPerCall,
          state.policy.maxOutputTokensPerCall,
        ),
      },
    };
  }

  const allowed = new Set(state.policy.allowedTools);
  const tools = suppliedTools.filter((tool) => {
    const name = tool?.function?.name ?? tool?.name;
    return allowed.has(name);
  });

  if (tools.length === 0) {
    failClosed(state, "required-tool-surface-unavailable");
    throw new Error(`No authorized tool is available for the ${state.lane} lane`);
  }

  state.modelCalls += 1;

  return {
    terminal: false,
    allowedTools: tools.map((tool) => tool?.function?.name ?? tool?.name),
    request: {
      ...(request ?? {}),
      tools,
      tool_choice: "auto",
      max_tokens: Math.min(
        Number.isFinite(request?.max_tokens) ? request.max_tokens : state.policy.maxOutputTokensPerCall,
        state.policy.maxOutputTokensPerCall,
      ),
    },
  };
}

export function beforeToolCall(state, toolName, args, now = Date.now()) {
  // Count the proposal before any validation. Blocked, malformed, and late calls all cost budget.
  state.toolAttempts += 1;

  if (state.phase !== "active") {
    return failClosed(state, "tool-proposed-outside-active-phase");
  }
  if (now - state.startedAt >= state.policy.deadlineMs) {
    moveToFinalization(state, "deadline-exhausted");
    return { allow: false, finalize: true, reason: state.stopReason };
  }
  if (state.toolAttempts > state.policy.maxToolAttempts) {
    moveToFinalization(state, "tool-attempt-budget-exhausted");
    return { allow: false, finalize: true, reason: state.stopReason };
  }
  if (!state.policy.allowedTools.includes(toolName)) {
    state.failures += 1;
    moveToFinalization(state, "tool-not-authorized-for-lane");
    return { allow: false, finalize: true, reason: state.stopReason };
  }

  const fingerprint = fingerprintToolCall(toolName, args);
  const seen = state.fingerprints.get(fingerprint) ?? 0;
  state.fingerprints.set(fingerprint, seen + 1);
  if (seen > 0) {
    state.consecutiveNoProgress += 1;
    if (state.consecutiveNoProgress >= state.policy.maxNoProgress) {
      moveToFinalization(state, "repeated-tool-request");
      return { allow: false, finalize: true, reason: state.stopReason };
    }
  }

  return { allow: true, fingerprint };
}

export function afterToolCall(state, outcome = {}) {
  if (state.phase !== "active") return;
  state.toolExecutions += 1;

  if (outcome.success !== true) {
    state.failures += 1;
  }

  const digest = typeof outcome.evidenceDigest === "string" ? outcome.evidenceDigest.trim() : "";
  if (!digest || state.evidenceDigests.has(digest)) {
    state.consecutiveNoProgress += 1;
  } else {
    state.evidenceDigests.add(digest);
    state.consecutiveNoProgress = 0;
  }

  if (state.failures >= state.policy.maxFailures) {
    moveToFinalization(state, "tool-failure-budget-exhausted");
  } else if (state.consecutiveNoProgress >= state.policy.maxNoProgress) {
    moveToFinalization(state, "no-progress-budget-exhausted");
  } else if (state.toolAttempts >= state.policy.maxToolAttempts) {
    moveToFinalization(state, "tool-attempt-budget-exhausted");
  }
}

export function finishModelCall(state, response, usage = {}) {
  state.inputTokens += Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  state.outputTokens += Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;

  const toolCalls = Array.isArray(response?.tool_calls) ? response.tool_calls : [];
  if (state.finalModelCallStarted) {
    if (toolCalls.length > 0) {
      failClosed(state, "terminal-response-contained-tool-call");
      throw new Error("Terminal response attempted a tool call");
    }
    if (typeof response?.content !== "string" || response.content.trim() === "") {
      failClosed(state, "terminal-response-missing-text");
      throw new Error("Terminal response did not contain user-visible text");
    }
    state.phase = "complete";
    return;
  }

  if (toolCalls.length === 0 && typeof response?.content === "string" && response.content.trim()) {
    state.phase = "complete";
  }
}

export async function runBoundedOperations(items, execute, options = {}) {
  const maxOperations = Math.min(5, Math.max(1, options.maxOperations ?? 5));
  const maxFailures = Math.max(1, options.maxFailures ?? 2);
  const maxNoProgress = Math.max(1, options.maxNoProgress ?? 2);
  const deadlineMs = Math.max(1, options.deadlineMs ?? 60_000);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const evidence = new Set();
  const results = [];
  let attempts = 0;
  let failures = 0;
  let consecutiveNoProgress = 0;
  let stopReason = "work-complete";

  for (const item of items) {
    if (attempts >= maxOperations) {
      stopReason = "operation-budget-exhausted";
      break;
    }
    if (now() - startedAt >= deadlineMs) {
      stopReason = "deadline-exhausted";
      break;
    }

    attempts += 1;
    let result;
    try {
      result = await execute(item, attempts);
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : String(error) };
    }
    results.push(result);

    if (result?.success !== true) failures += 1;
    const digest = typeof result?.evidenceDigest === "string" ? result.evidenceDigest.trim() : "";
    if (!digest || evidence.has(digest)) {
      consecutiveNoProgress += 1;
    } else {
      evidence.add(digest);
      consecutiveNoProgress = 0;
    }

    if (failures >= maxFailures) {
      stopReason = "failure-budget-exhausted";
      break;
    }
    if (consecutiveNoProgress >= maxNoProgress) {
      stopReason = "no-progress-budget-exhausted";
      break;
    }
  }

  return {
    attempts,
    failures,
    uniqueEvidence: evidence.size,
    stopReason,
    results,
  };
}

export function snapshotGovernor(state) {
  return {
    lane: state.lane,
    phase: state.phase,
    stopReason: state.stopReason,
    modelCalls: state.modelCalls,
    toolAttempts: state.toolAttempts,
    toolExecutions: state.toolExecutions,
    failures: state.failures,
    consecutiveNoProgress: state.consecutiveNoProgress,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    uniqueEvidence: state.evidenceDigests.size,
  };
}
