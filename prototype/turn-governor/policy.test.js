import assert from "node:assert/strict";
import test from "node:test";

import {
  afterToolCall,
  beforeToolCall,
  createTurnGovernor,
  finishModelCall,
  fingerprintToolCall,
  prepareModelRequest,
  runBoundedOperations,
  snapshotGovernor,
} from "./policy.js";
import { sparkyMemoryLoop } from "./sparky-loop-fixture.js";

const tool = (name) => ({ type: "function", function: { name, parameters: { type: "object" } } });
const allTools = [
  tool("graph_recall"),
  tool("graph_status"),
  tool("research_batch"),
  tool("work_submit"),
  tool("memory_search"),
  tool("web_search"),
  tool("message"),
];

test("chat lane sends exactly one model request with no tool surface", () => {
  const state = createTurnGovernor("chat", {}, 1_000);
  const prepared = prepareModelRequest(
    state,
    { model: "nvidia/llama-3.3-nemotron-super-49b-v1.5", tools: allTools, tool_choice: "auto" },
    1_001,
  );

  assert.equal(prepared.terminal, true);
  assert.deepEqual(prepared.allowedTools, []);
  assert.equal("tools" in prepared.request, false);
  assert.equal("tool_choice" in prepared.request, false);
  assert.equal(prepared.request.max_tokens, 800);
  finishModelCall(state, { content: "Direct answer." }, { inputTokens: 30, outputTokens: 4 });
  assert.deepEqual(snapshotGovernor(state), {
    lane: "chat",
    phase: "complete",
    stopReason: "lane-has-no-tools",
    modelCalls: 1,
    toolAttempts: 0,
    toolExecutions: 0,
    failures: 0,
    consecutiveNoProgress: 0,
    inputTokens: 30,
    outputTokens: 4,
    uniqueEvidence: 0,
  });
});

test("recall lane exposes only graph tools, permits one call, then strips every tool", () => {
  const state = createTurnGovernor("recall", {}, 2_000);
  const active = prepareModelRequest(state, { tools: allTools }, 2_001);
  assert.deepEqual(active.allowedTools, ["graph_recall", "graph_status"]);

  const decision = beforeToolCall(state, "graph_recall", { query: "Is graph memory working?" }, 2_002);
  assert.equal(decision.allow, true);
  afterToolCall(state, { success: true, evidenceDigest: "graph-ready:v1" });
  assert.equal(state.phase, "finalizing");

  const finalRequest = prepareModelRequest(
    state,
    { tools: allTools, tool_choice: "auto", parallel_tool_calls: true },
    2_003,
  );
  assert.equal(finalRequest.terminal, true);
  assert.equal("tools" in finalRequest.request, false);
  assert.equal("tool_choice" in finalRequest.request, false);
  assert.equal("parallel_tool_calls" in finalRequest.request, false);
  assert.equal(finalRequest.request.max_tokens, 800);

  finishModelCall(state, { content: "Yes. The graph service is healthy." });
  assert.equal(state.phase, "complete");
  assert.equal(state.modelCalls, 2);
  assert.equal(state.toolAttempts, 1);
});

test("terminal model output containing a structured tool call fails closed", () => {
  const state = createTurnGovernor("chat", {}, 3_000);
  prepareModelRequest(state, { tools: allTools }, 3_001);
  assert.throws(
    () => finishModelCall(state, { content: "", tool_calls: [{ function: { name: "web_search" } }] }),
    /attempted a tool call/i,
  );
  assert.equal(state.phase, "aborted");
});

test("captured 30-call memory/web churn is stopped before a second tool can execute", () => {
  assert.equal(sparkyMemoryLoop.length, 30);
  assert.equal(sparkyMemoryLoop.filter(([name]) => name === "memory_search").length, 22);
  assert.equal(sparkyMemoryLoop.filter(([name]) => name === "web_search").length, 6);

  const state = createTurnGovernor("recall", {}, 4_000);
  prepareModelRequest(state, { tools: allTools }, 4_001);

  let allowed = 0;
  let aborted = false;
  for (const [name, args] of sparkyMemoryLoop) {
    const decision = beforeToolCall(state, name, args, 4_002);
    if (decision.allow) allowed += 1;
    if (decision.abort) {
      aborted = true;
      break;
    }
  }

  assert.equal(allowed, 0, "legacy raw memory_search must not be exposed in the recall lane");
  assert.equal(aborted, true);
  assert.equal(state.toolAttempts, 2, "blocked and late proposals must both be counted");
  assert.equal(state.phase, "aborted");
});

test("semantic fingerprints ignore budget-only argument churn", () => {
  const first = fingerprintToolCall("graph_recall", { query: " Graph   Memory ", maxResults: 10 });
  const second = fingerprintToolCall("graph_recall", { maxResults: 50, query: "graph memory" });
  assert.equal(first, second);
});

test("research worker executes at most five operations even when every result is useful", async () => {
  const work = Array.from({ length: 30 }, (_, index) => ({ query: `source ${index}` }));
  const result = await runBoundedOperations(
    work,
    async (_item, attempt) => ({ success: true, evidenceDigest: `evidence-${attempt}` }),
    { maxOperations: 5 },
  );

  assert.equal(result.attempts, 5);
  assert.equal(result.uniqueEvidence, 5);
  assert.equal(result.stopReason, "operation-budget-exhausted");
});

test("research worker stops after two no-progress results", async () => {
  const result = await runBoundedOperations(
    [1, 2, 3, 4, 5],
    async () => ({ success: true, evidenceDigest: "" }),
    { maxOperations: 5, maxNoProgress: 2 },
  );

  assert.equal(result.attempts, 2);
  assert.equal(result.stopReason, "no-progress-budget-exhausted");
});

test("research worker counts thrown and failed operations and stops after two", async () => {
  const result = await runBoundedOperations(
    ["throw", "fail", "unreached"],
    async (item) => {
      if (item === "throw") throw new Error("network down");
      return { success: false, error: "blocked" };
    },
    { maxFailures: 2, maxNoProgress: 99 },
  );

  assert.equal(result.attempts, 2);
  assert.equal(result.failures, 2);
  assert.equal(result.stopReason, "failure-budget-exhausted");
});

test("deadline forces the next provider request into terminal no-tool mode", () => {
  const state = createTurnGovernor("research", { deadlineMs: 10 }, 5_000);
  const prepared = prepareModelRequest(state, { tools: allTools }, 5_010);
  assert.equal(prepared.terminal, true);
  assert.equal("tools" in prepared.request, false);
  assert.equal(state.stopReason, "deadline-exhausted");
});

test("terminal finalization is single-use", () => {
  const state = createTurnGovernor("chat", {}, 6_000);
  prepareModelRequest(state, { tools: allTools }, 6_001);
  assert.throws(() => prepareModelRequest(state, { tools: allTools }, 6_002), /only once/i);
  assert.equal(state.phase, "aborted");
});

test("a missing lane tool fails closed before a provider request", () => {
  const state = createTurnGovernor("research", {}, 7_000);
  assert.throws(
    () => prepareModelRequest(state, { tools: [tool("web_search")] }, 7_001),
    /no authorized tool/i,
  );
  assert.equal(state.phase, "aborted");
  assert.equal(state.modelCalls, 0);
  assert.equal(state.stopReason, "required-tool-surface-unavailable");
});

test("input estimates fail before billing and output limits are clamped", () => {
  const oversized = createTurnGovernor("chat", {}, 8_000);
  assert.throws(
    () => prepareModelRequest(oversized, { tools: allTools }, 8_001, { estimatedInputTokens: 12_001 }),
    /input exceeds/i,
  );
  assert.equal(oversized.modelCalls, 0);

  const bounded = createTurnGovernor("chat", {}, 8_000);
  const prepared = prepareModelRequest(
    bounded,
    { tools: allTools, max_tokens: 50_000 },
    8_001,
    { estimatedInputTokens: 4_000 },
  );
  assert.equal(prepared.request.max_tokens, 800);
});

test("5,000 adversarial turns always terminate within two model calls and one tool execution", () => {
  let randomState = 0x5eed1234;
  const random = () => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0x1_0000_0000;
  };
  const lanes = ["chat", "recall", "research", "work"];
  const adversarialTools = [
    "graph_recall",
    "graph_status",
    "research_batch",
    "work_submit",
    "memory_search",
    "web_search",
    "message",
    "unknown_tool",
  ];

  for (let run = 0; run < 5_000; run += 1) {
    const lane = lanes[Math.floor(random() * lanes.length)];
    const state = createTurnGovernor(lane, {}, 10_000);
    let steps = 0;

    while (state.phase !== "complete" && state.phase !== "aborted" && steps < 10) {
      steps += 1;
      const prepared = prepareModelRequest(state, { tools: allTools }, 10_000 + steps);
      if (prepared.terminal) {
        assert.equal("tools" in prepared.request, false);
        if (run % 97 === 0) {
          assert.throws(
            () => finishModelCall(state, { content: "", tool_calls: [{ function: { name: "web_search" } }] }),
            /attempted a tool call/i,
          );
        } else {
          finishModelCall(state, { content: "Bounded final answer." });
        }
        continue;
      }

      const name = adversarialTools[Math.floor(random() * adversarialTools.length)];
      const args = {
        query: random() < 0.25 ? "" : `query-${Math.floor(random() * 4)}`,
        maxResults: 1 + Math.floor(random() * 100),
      };
      finishModelCall(state, { content: "", tool_calls: [{ function: { name, arguments: args } }] });
      const decision = beforeToolCall(state, name, args, 10_000 + steps);
      if (decision.allow) {
        const useful = random() >= 0.5;
        afterToolCall(state, {
          success: useful,
          evidenceDigest: useful ? `evidence-${run}` : "",
        });
      }
    }

    assert.ok(state.phase === "complete" || state.phase === "aborted");
    assert.ok(state.modelCalls <= state.policy.maxModelCalls);
    assert.ok(state.toolExecutions <= 1);
    assert.ok(steps <= 2);
  }
});
