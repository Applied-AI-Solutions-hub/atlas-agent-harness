import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REPORT_ID_PATTERN } from "./render-report.mjs";

const SECURITY_HEADERS = Object.freeze({
  "cache-control": "private, no-store, max-age=0",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
});

function send(response, status, body, contentType, method = "GET") {
  response.writeHead(status, { ...SECURITY_HEADERS, "content-type": contentType, "content-length": Buffer.byteLength(body) });
  if (method === "HEAD") response.end();
  else response.end(body);
}

function createReportServer({ reportDir, maxFileBytes = 5 * 1024 * 1024 } = {}) {
  const root = resolve(reportDir);
  return createServer(async (request, response) => {
    const method = request.method || "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      send(response, 405, "Method not allowed\n", "text/plain; charset=utf-8", method);
      return;
    }
    let path;
    try {
      path = new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch {
      send(response, 400, "Bad request\n", "text/plain; charset=utf-8", method);
      return;
    }
    if (path === "/healthz") {
      send(response, 200, '{"ok":true,"service":"atlas-report-bridge"}\n', "application/json; charset=utf-8", method);
      return;
    }

    const htmlMatch = path.match(/^\/r\/([a-f0-9]{32})$/);
    const jsonMatch = path.match(/^\/api\/reports\/([a-f0-9]{32})$/);
    const match = htmlMatch || jsonMatch;
    if (!match || !REPORT_ID_PATTERN.test(match[1])) {
      send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
      return;
    }

    const extension = htmlMatch ? "html" : "json";
    const filePath = join(root, `${match[1]}.${extension}`);
    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size > maxFileBytes) {
        send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
        return;
      }
      const body = await readFile(filePath);
      send(response, 200, body, extension === "html" ? "text/html; charset=utf-8" : "application/json; charset=utf-8", method);
    } catch (error) {
      if (error?.code === "ENOENT") send(response, 404, "Not found\n", "text/plain; charset=utf-8", method);
      else send(response, 500, "Internal error\n", "text/plain; charset=utf-8", method);
    }
  });
}

async function main() {
  const reportDir = resolve(process.env.ATLAS_REPORT_DIR || join(process.cwd(), "reports"));
  const host = process.env.ATLAS_REPORT_HOST || "127.0.0.1";
  const port = Number(process.env.ATLAS_REPORT_PORT || 8787);
  if (host !== "127.0.0.1" && host !== "::1") throw new Error("Report bridge must bind to loopback; use Tailscale Serve for private remote access");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ATLAS_REPORT_PORT must be an integer from 1024 through 65535");
  const server = createReportServer({ reportDir });
  server.listen(port, host, () => process.stdout.write(`Atlas report bridge listening on http://${host}:${port}\n`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { SECURITY_HEADERS, createReportServer };
