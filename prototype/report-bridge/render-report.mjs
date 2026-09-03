import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPORT_ID_PATTERN = /^[a-f0-9]{32}$/;
const PRIVACY_CLASSES = new Set(["public", "personal", "business-private"]);
const STATUSES = new Set(["Completed", "Partial", "Failed"]);

function assertAllowedProperties(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unsupported property: ${key}`);
  }
}

function assertString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeSourceUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`Source URL must use http or https: ${value}`);
  }
  if (parsed.username || parsed.password) throw new Error("Source URL must not contain credentials");
  return parsed.href;
}

function validateReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Report must be an object");
  assertAllowedProperties(input, new Set([
    "schemaVersion", "reportId", "generatedAt", "title", "status", "privacyClass",
    "summary", "execution", "sections", "sources"
  ]), "Report");
  if (input.schemaVersion !== 1) throw new Error("schemaVersion must equal 1");
  if (input.reportId !== undefined && !REPORT_ID_PATTERN.test(input.reportId)) throw new Error("reportId is invalid");
  if (input.generatedAt !== undefined && (!Number.isFinite(Date.parse(input.generatedAt)) || !/^\d{4}-\d{2}-\d{2}T/.test(input.generatedAt))) throw new Error("generatedAt is invalid");
  assertString(input.title, "title", 200);
  if (!STATUSES.has(input.status)) throw new Error("status is invalid");
  if (!PRIVACY_CLASSES.has(input.privacyClass)) throw new Error("privacyClass is invalid");
  if (!Array.isArray(input.summary) || input.summary.length < 1 || input.summary.length > 10) throw new Error("summary must contain 1 to 10 paragraphs");
  input.summary.forEach((text, index) => assertString(text, `summary[${index}]`, 4000));
  if (input.execution !== undefined) {
    if (!input.execution || typeof input.execution !== "object" || Array.isArray(input.execution)) throw new Error("execution must be an object");
    assertAllowedProperties(input.execution, new Set(["currentAction", "lastSuccess", "worker", "fallbackUsed"]), "execution");
    for (const field of ["currentAction", "lastSuccess"]) {
      if (input.execution[field] !== null) assertString(input.execution[field], `execution.${field}`, 500);
    }
    if (input.execution.worker !== undefined && input.execution.worker !== null) assertString(input.execution.worker, "execution.worker", 100);
    if (input.execution.fallbackUsed !== undefined && typeof input.execution.fallbackUsed !== "boolean") throw new Error("execution.fallbackUsed must be boolean");
  }
  if (!Array.isArray(input.sources) || input.sources.length > 100) throw new Error("sources must be an array of at most 100 entries");
  const sourceIds = new Set();
  for (const [index, source] of input.sources.entries()) {
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error(`sources[${index}] must be an object`);
    assertAllowedProperties(source, new Set(["id", "title", "url", "publisher", "accessedAt"]), `sources[${index}]`);
    assertString(source?.id, `sources[${index}].id`, 64);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(source.id)) throw new Error(`sources[${index}].id is invalid`);
    if (sourceIds.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    sourceIds.add(source.id);
    assertString(source.title, `sources[${index}].title`, 300);
    safeSourceUrl(source.url);
    if (source.publisher !== undefined) assertString(source.publisher, `sources[${index}].publisher`, 200);
    if (source.accessedAt !== undefined && !Number.isFinite(Date.parse(source.accessedAt))) throw new Error(`sources[${index}].accessedAt is invalid`);
  }
  if (!Array.isArray(input.sections) || input.sections.length > 30) throw new Error("sections must be an array of at most 30 entries");
  for (const [sectionIndex, section] of input.sections.entries()) {
    if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`sections[${sectionIndex}] must be an object`);
    assertAllowedProperties(section, new Set(["heading", "blocks"]), `sections[${sectionIndex}]`);
    assertString(section?.heading, `sections[${sectionIndex}].heading`, 200);
    if (!Array.isArray(section.blocks) || section.blocks.length < 1 || section.blocks.length > 50) throw new Error(`sections[${sectionIndex}].blocks is invalid`);
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error(`sections[${sectionIndex}].blocks[${blockIndex}] must be an object`);
      assertAllowedProperties(block, block.type === "paragraph" ? new Set(["type", "text", "sourceIds"]) : new Set(["type", "items", "sourceIds"]), `sections[${sectionIndex}].blocks[${blockIndex}]`);
      if (block?.type === "paragraph") assertString(block.text, `sections[${sectionIndex}].blocks[${blockIndex}].text`, 12000);
      else if (block?.type === "bullets") {
        if (!Array.isArray(block.items) || block.items.length < 1 || block.items.length > 50) throw new Error(`sections[${sectionIndex}].blocks[${blockIndex}].items is invalid`);
        block.items.forEach((item, itemIndex) => assertString(item, `sections[${sectionIndex}].blocks[${blockIndex}].items[${itemIndex}]`, 4000));
      } else throw new Error(`sections[${sectionIndex}].blocks[${blockIndex}].type is invalid`);
      if (block.sourceIds !== undefined && (!Array.isArray(block.sourceIds) || block.sourceIds.length > 20 || new Set(block.sourceIds).size !== block.sourceIds.length)) throw new Error(`sections[${sectionIndex}].blocks[${blockIndex}].sourceIds is invalid`);
      for (const id of block.sourceIds || []) {
        if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid source id: ${id}`);
        if (!sourceIds.has(id)) throw new Error(`Unknown source id: ${id}`);
      }
    }
  }
  return input;
}

function citationHtml(sourceIds, sourceMap) {
  if (!sourceIds?.length) return "";
  return `<span class="citations">${sourceIds.map((id) => {
    const source = sourceMap.get(id);
    return `<a href="${escapeHtml(safeSourceUrl(source.url))}" target="_blank" rel="noopener noreferrer" aria-label="Source: ${escapeHtml(source.title)}">${escapeHtml(id)}</a>`;
  }).join(" ")}</span>`;
}

function renderHtml(report, { reportId, generatedAt, jsonPath }) {
  validateReport(report);
  if (!REPORT_ID_PATTERN.test(reportId)) throw new Error("reportId is invalid");
  const sources = new Map(report.sources.map((source) => [source.id, source]));
  const summary = report.summary.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  const sections = report.sections.map((section, index) => {
    const blocks = section.blocks.map((block) => block.type === "paragraph"
      ? `<p>${escapeHtml(block.text)} ${citationHtml(block.sourceIds, sources)}</p>`
      : `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>${citationHtml(block.sourceIds, sources)}`
    ).join("\n");
    return `<section id="section-${index + 1}"><h2>${escapeHtml(section.heading)}</h2>${blocks}</section>`;
  }).join("\n");
  const sourceList = report.sources.length
    ? `<ol>${report.sources.map((source) => `<li id="source-${escapeHtml(source.id)}"><a href="${escapeHtml(safeSourceUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a>${source.publisher ? ` <span>— ${escapeHtml(source.publisher)}</span>` : ""}</li>`).join("")}</ol>`
    : "<p>No external sources were used.</p>";
  const execution = report.execution ? `<aside><strong>Current:</strong> ${escapeHtml(report.execution.currentAction || "Complete")}<br><strong>Last success:</strong> ${escapeHtml(report.execution.lastSuccess || "Not reported")}<br><strong>Worker:</strong> ${escapeHtml(report.execution.worker || "Not reported")}<br><strong>Fallback:</strong> ${report.execution.fallbackUsed ? "Used and disclosed" : "Not used"}</aside>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(report.title)}</title>
<style>:root{color-scheme:light dark;--bg:#0b1220;--card:#111c30;--text:#edf4ff;--muted:#9fb0c9;--accent:#79e0c3;--line:#263750}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:900px;margin:auto;padding:clamp(20px,5vw,64px)}header,section,aside{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:clamp(18px,4vw,32px);margin:0 0 18px}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;margin:.25em 0}h2{font-size:1.35rem;margin-top:0}a{color:var(--accent);overflow-wrap:anywhere}.meta{color:var(--muted);font-size:.9rem}.pill{display:inline-block;border:1px solid var(--accent);border-radius:999px;padding:.2rem .65rem;margin-right:.4rem}.citations a{display:inline-block;font-size:.75rem;text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:0 .35rem}li+li{margin-top:.5rem}footer{color:var(--muted);font-size:.85rem;padding:1rem}@media(prefers-color-scheme:light){:root{--bg:#f3f7fb;--card:#fff;--text:#122034;--muted:#52657d;--accent:#006e5c;--line:#d6e0ea}}</style></head>
<body><main><header><div><span class="pill">${escapeHtml(report.status)}</span><span class="pill">${escapeHtml(report.privacyClass)}</span></div><h1>${escapeHtml(report.title)}</h1><div class="meta">Report ${reportId} · ${escapeHtml(generatedAt)}</div>${summary}</header>${execution}${sections}<section><h2>Sources</h2>${sourceList}</section><footer><a href="${escapeHtml(jsonPath)}">Agent-readable JSON</a> · The HTML and JSON were generated from the same validated report object.</footer></main></body></html>`;
}

async function writeAtomic(path, content, mode = 0o600) {
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, path);
}

async function materializeReport(report, { outputDir, reportId = randomBytes(16).toString("hex"), now = new Date() } = {}) {
  validateReport(report);
  if (!REPORT_ID_PATTERN.test(reportId)) throw new Error("reportId is invalid");
  const root = resolve(outputDir);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const generatedAt = now.toISOString();
  const canonical = { ...report, reportId, generatedAt };
  validateReport(canonical);
  const jsonName = `${reportId}.json`;
  const htmlName = `${reportId}.html`;
  await writeAtomic(join(root, jsonName), `${JSON.stringify(canonical, null, 2)}\n`);
  await writeAtomic(join(root, htmlName), renderHtml(report, {
    reportId,
    generatedAt,
    jsonPath: `/api/reports/${reportId}`
  }));
  return { reportId, generatedAt, htmlPath: join(root, htmlName), jsonPath: join(root, jsonName) };
}

async function main() {
  const [inputPath, outputDir] = process.argv.slice(2);
  if (!inputPath || !outputDir) throw new Error("Usage: render-report.mjs <report.json> <output-directory>");
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  process.stdout.write(`${JSON.stringify(await materializeReport(report, { outputDir: resolve(outputDir) }), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { REPORT_ID_PATTERN, escapeHtml, materializeReport, renderHtml, safeSourceUrl, validateReport };
