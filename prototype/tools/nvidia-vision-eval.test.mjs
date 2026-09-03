import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCase, percentile, scoreResponse, summarize } from "./nvidia-vision-eval.mjs";

test("scores required facts without case sensitivity", () => {
  const result = scoreResponse({ requiredFacts: ["two cats"], forbiddenClaims: ["dog"] }, "TWO CATS are resting.");
  assert.equal(result.pass, true);
  assert.equal(result.requiredHitRate, 1);
});

test("fails a response that repeats a forbidden claim", () => {
  const result = scoreResponse({ requiredFacts: ["bus"], forbiddenClaims: ["specific city"] }, "A bus in a specific city.");
  assert.equal(result.pass, false);
  assert.equal(result.hallucinationCount, 1);
});

test("calculates nearest-rank percentiles", () => {
  assert.equal(percentile([40, 10, 30, 20], 95), 40);
  assert.equal(percentile([], 95), null);
});

test("sends the NVIDIA vision chat-completions contract", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Two cats on indoor furniture" } }] }) };
  };
  const result = await evaluateCase({
    testCase: { id: "cats", kind: "photo", imageUrl: "https://example.test/cats.jpg", prompt: "Describe it", requiredFacts: ["two cats", "indoor furniture"], forbiddenClaims: ["dog"] },
    manifestPath: "/tmp/manifest.json",
    key: "not-a-real-key",
    model: "meta/llama-3.2-11b-vision-instruct",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    timeoutMs: 1000,
    fetchImpl
  });
  assert.equal(result.score.pass, true);
  assert.equal(request.url, "https://integrate.api.nvidia.com/v1/chat/completions");
  assert.equal(request.body.messages[0].content[1].type, "image_url");
  assert.match(request.options.headers.authorization, /^Bearer /);
  assert.doesNotMatch(JSON.stringify(result), /not-a-real-key/);
});

test("summary separates provider reliability from task quality", () => {
  const report = summarize([
    { id: "good", kind: "ocr", ok: true, latencyMs: 100, score: { pass: true, requiredHitRate: 1, requiredMatches: [{ matched: true }], forbiddenMatches: [{ matched: false }] } },
    { id: "failed", kind: "photo", ok: false, latencyMs: 50, error: "HTTP 429" }
  ], "vision-model");
  assert.equal(report.providerSuccessRate, 0.5);
  assert.equal(report.taskAccuracy, 1);
  assert.equal(report.ocrAccuracy, 1);
  assert.equal(report.hallucinationRate, 0);
});
