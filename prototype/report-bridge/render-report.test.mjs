import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeReport, renderHtml, validateReport } from "./render-report.mjs";

function fixture() {
  return {
    schemaVersion: 1,
    title: "Pipeline result",
    status: "Completed",
    privacyClass: "personal",
    summary: ["The pipeline completed."],
    execution: { currentAction: null, lastSuccess: "Returned the answer", worker: "nvidia-build", fallbackUsed: false },
    sections: [{ heading: "Answer", blocks: [{ type: "paragraph", text: "Safe answer", sourceIds: ["nvidia-docs"] }] }],
    sources: [{ id: "nvidia-docs", title: "NVIDIA docs", url: "https://docs.nvidia.com/example" }]
  };
}

test("renders one escaped responsive document with linked citations", () => {
  const report = fixture();
  report.sections[0].blocks[0].text = "<script>alert(1)</script>";
  const html = renderHtml(report, {
    reportId: "0123456789abcdef0123456789abcdef",
    generatedAt: "2026-09-02T00:00:00.000Z",
    jsonPath: "/api/reports/0123456789abcdef0123456789abcdef"
  });
  assert.match(html, /viewport/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /https:\/\/docs\.nvidia\.com\/example/);
});

test("rejects credential-bearing or non-web source URLs", () => {
  const report = fixture();
  report.sources[0].url = "file:///etc/passwd";
  assert.throws(() => validateReport(report), /http or https/);
  report.sources[0].url = "https://user:password@example.com/private";
  assert.throws(() => validateReport(report), /credentials/);
});

test("rejects citations that do not exist in the source list", () => {
  const report = fixture();
  report.sections[0].blocks[0].sourceIds = ["missing-source"];
  assert.throws(() => validateReport(report), /Unknown source id/);
});

test("rejects properties outside the shared schema", () => {
  const report = fixture();
  report.hiddenPrompt = "must not leak";
  assert.throws(() => validateReport(report), /unsupported property/);
});

test("accepts canonical identity fields after materialization", () => {
  const report = fixture();
  report.reportId = "0123456789abcdef0123456789abcdef";
  report.generatedAt = "2026-09-02T01:02:03.000Z";
  assert.equal(validateReport(report), report);
});

test("materializes matching immutable HTML and canonical JSON files", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-report-"));
  const result = await materializeReport(fixture(), {
    outputDir: root,
    reportId: "fedcba9876543210fedcba9876543210",
    now: new Date("2026-09-02T01:02:03.000Z")
  });
  const json = JSON.parse(await readFile(result.jsonPath, "utf8"));
  const html = await readFile(result.htmlPath, "utf8");
  assert.equal(json.reportId, result.reportId);
  assert.equal(json.generatedAt, "2026-09-02T01:02:03.000Z");
  assert.match(html, /Agent-readable JSON/);
  assert.match(html, new RegExp(result.reportId));
});
