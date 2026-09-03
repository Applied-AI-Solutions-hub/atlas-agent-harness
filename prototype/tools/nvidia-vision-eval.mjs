#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.2-11b-vision-instruct";

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.ceil((percentileValue / 100) * ordered.length) - 1];
}

function includesClaim(text, claim) {
  return text.toLocaleLowerCase().includes(claim.toLocaleLowerCase());
}

function scoreResponse(testCase, responseText) {
  const requiredFacts = testCase.requiredFacts || [];
  const forbiddenClaims = testCase.forbiddenClaims || [];
  const requiredMatches = requiredFacts.map(claim => ({ claim, matched: includesClaim(responseText, claim) }));
  const forbiddenMatches = forbiddenClaims.map(claim => ({ claim, matched: includesClaim(responseText, claim) }));
  const requiredHitRate = requiredFacts.length
    ? requiredMatches.filter(item => item.matched).length / requiredFacts.length
    : 1;
  const hallucinationCount = forbiddenMatches.filter(item => item.matched).length;
  return {
    requiredMatches,
    forbiddenMatches,
    requiredHitRate,
    hallucinationCount,
    pass: requiredHitRate === 1 && hallucinationCount === 0
  };
}

function mimeTypeFor(path) {
  return ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff" })[extname(path).toLowerCase()] || "application/octet-stream";
}

async function imageReference(testCase, manifestPath) {
  if (testCase.imageUrl) return testCase.imageUrl;
  if (!testCase.imagePath) throw new Error(`${testCase.id}: imageUrl or imagePath is required`);
  const absolute = resolve(resolve(manifestPath, ".."), testCase.imagePath);
  const bytes = await readFile(absolute);
  return `data:${mimeTypeFor(absolute)};base64,${bytes.toString("base64")}`;
}

async function evaluateCase({ testCase, manifestPath, key, model, baseUrl, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: `${testCase.prompt}\n\nDo not guess. Explicitly mark anything unreadable or uncertain.` },
            { type: "image_url", image_url: { url: await imageReference(testCase, manifestPath) } }
          ]
        }],
        temperature: 0,
        max_tokens: 700,
        stream: false
      })
    });
    const body = await response.json().catch(() => ({}));
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return { id: testCase.id, kind: testCase.kind, ok: false, status: response.status, latencyMs, error: body?.detail || body?.message || `HTTP ${response.status}` };
    }
    const output = body?.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim()) {
      return { id: testCase.id, kind: testCase.kind, ok: false, status: response.status, latencyMs, error: "Provider returned no text" };
    }
    return { id: testCase.id, kind: testCase.kind, ok: true, status: response.status, latencyMs, output, score: scoreResponse(testCase, output) };
  } catch (error) {
    return { id: testCase.id, kind: testCase.kind, ok: false, latencyMs: Math.round(performance.now() - started), error: error.name === "AbortError" ? `Timed out after ${timeoutMs} ms` : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function summarize(results, model) {
  const successful = results.filter(result => result.ok);
  const scored = successful.filter(result => result.score);
  const requiredFacts = scored.flatMap(result => result.score.requiredMatches);
  const forbiddenClaims = scored.flatMap(result => result.score.forbiddenMatches);
  const ocrCases = scored.filter(result => result.kind === "ocr");
  return {
    model,
    cases: results.length,
    completed: successful.length,
    providerSuccessRate: results.length ? successful.length / results.length : 0,
    taskAccuracy: scored.length ? scored.filter(result => result.score.pass).length / scored.length : 0,
    factRecall: requiredFacts.length ? requiredFacts.filter(item => item.matched).length / requiredFacts.length : 0,
    ocrAccuracy: ocrCases.length ? ocrCases.reduce((total, result) => total + result.score.requiredHitRate, 0) / ocrCases.length : 0,
    hallucinationRate: forbiddenClaims.length ? forbiddenClaims.filter(item => item.matched).length / forbiddenClaims.length : 0,
    p95LatencyMs: percentile(successful.map(result => result.latencyMs), 95),
    results
  };
}

async function runEvaluation({ manifestPath, outputPath, key, model = DEFAULT_MODEL, baseUrl = DEFAULT_BASE_URL, timeoutMs = 60000, fetchImpl = fetch }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) throw new Error("Evaluation manifest must contain cases");
  const results = [];
  for (const testCase of manifest.cases) {
    results.push(await evaluateCase({ testCase, manifestPath, key, model, baseUrl, timeoutMs, fetchImpl }));
  }
  const report = summarize(results, model);
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return report;
}

async function main() {
  const [manifestArgument, outputArgument] = process.argv.slice(2);
  if (!manifestArgument) throw new Error("Usage: nvidia-vision-eval.mjs <manifest.json> [report.json]");
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY must be injected by the protected runtime");
  const manifestPath = resolve(manifestArgument);
  const report = await runEvaluation({
    manifestPath,
    outputPath: outputArgument ? resolve(outputArgument) : undefined,
    key,
    model: process.env.NVIDIA_VISION_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs: Number(process.env.NVIDIA_VISION_TIMEOUT_MS || 60000)
  });
  console.log(JSON.stringify({ ...report, results: report.results.map(({ output, ...result }) => result) }, null, 2));
  if (report.completed !== report.cases) process.exitCode = 2;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

export { evaluateCase, percentile, runEvaluation, scoreResponse, summarize };
