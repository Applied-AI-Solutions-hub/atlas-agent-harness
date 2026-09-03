#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const home = homedir();
const memoryPrincipalsPath = join(home, ".config", "atlas-memory", "principals.json");
const configDir = join(home, ".config", "work-graph");
const unitDir = join(home, ".config", "systemd", "user");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}

const memoryPrincipals = JSON.parse(await readFile(memoryPrincipalsPath, "utf8")).principals;
const principals = memoryPrincipals
  .filter((principal) => ["sparky", "atlas"].includes(principal.id))
  .map((principal) => ({ id: principal.id, tokenSha256: principal.tokenSha256, actions: ["work.submit", "work.read"], namespaces: principal.namespaces }));
if (principals.length !== 2) throw new Error("Expected distinct Sparky and Atlas principals in Atlas Memory configuration.");

await mkdir(configDir, { recursive: true });
await mkdir(unitDir, { recursive: true });
const principalsTarget = join(configDir, "principals.json");
await writeFile(`${principalsTarget}.new`, `${JSON.stringify({ principals }, null, 2)}\n`, { mode: 0o600 });
await rename(`${principalsTarget}.new`, principalsTarget);

const unitSource = new URL("./work-graph-api.service", import.meta.url);
const unitTarget = join(unitDir, "work-graph-api.service");
await writeFile(`${unitTarget}.new`, await readFile(unitSource, "utf8"), { mode: 0o600 });
await rename(`${unitTarget}.new`, unitTarget);
await run("/usr/bin/systemctl", ["--user", "daemon-reload"]);
await run("/usr/bin/systemctl", ["--user", "enable", "--now", "work-graph-api.service"]);

const deadline = Date.now() + 15_000;
let health;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:8792/health", { signal: AbortSignal.timeout(1_000) });
    if (response.ok) { health = await response.json(); break; }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!health?.ok) throw new Error("Work-graph API did not become healthy.");
console.log(JSON.stringify({ ok: true, service: "work-graph-api.service", endpoint: "http://127.0.0.1:8792", networkBoundary: "loopback-only", principals: principals.map(({ id }) => id) }, null, 2));
