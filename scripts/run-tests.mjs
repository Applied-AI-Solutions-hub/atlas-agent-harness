import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ignored = new Set([".git", "node_modules"]);

async function collect(directory) {
  const tests = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) tests.push(...await collect(path));
    else if (/\.test\.(?:js|mjs)$/.test(entry.name)) tests.push(path);
  }
  return tests;
}

const tests = (await collect(process.cwd())).sort();
if (!tests.length) throw new Error("No test files found");

const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: process.cwd(),
  stdio: "inherit"
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
