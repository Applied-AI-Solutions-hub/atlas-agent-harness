import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeReport } from "./render-report.mjs";
import { createReportServer } from "./server.mjs";

const REPORT_ID = "0123456789abcdef0123456789abcdef";

function fixture() {
  return {
    schemaVersion: 1,
    title: "Shared answer",
    status: "Completed",
    privacyClass: "personal",
    summary: ["Readable everywhere on the tailnet."],
    sections: [{ heading: "Answer", blocks: [{ type: "paragraph", text: "Complete" }] }],
    sources: []
  };
}

async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), "atlas-report-server-"));
  await materializeReport(fixture(), { outputDir: root, reportId: REPORT_ID });
  const server = createReportServer({ reportDir: root });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("serves matching human and agent views with defensive headers", async () => {
  await withServer(async (baseUrl) => {
    const html = await fetch(`${baseUrl}/r/${REPORT_ID}`);
    const json = await fetch(`${baseUrl}/api/reports/${REPORT_ID}`);
    assert.equal(html.status, 200);
    assert.equal(json.status, 200);
    assert.match(html.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(html.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.match(await html.text(), /Shared answer/);
    assert.equal((await json.json()).reportId, REPORT_ID);
  });
});

test("does not expose a directory index or accept path traversal", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/r/../../etc/passwd`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/r/not-an-id`)).status, 404);
  });
});

test("rejects mutation methods", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/r/${REPORT_ID}`, { method: "POST" });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
  });
});
