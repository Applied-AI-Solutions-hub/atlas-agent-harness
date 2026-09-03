#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const home = homedir();
const unitDir = join(home, ".config", "systemd", "user");
const units = ["home-gpu-work-graph.service", "home-gpu-work-graph.timer"];

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

await mkdir(unitDir, { recursive: true });
await mkdir(join(home, ".local", "share", "applied-ai"), { recursive: true });
await mkdir(join(home, "workspace", "results", "work-graph"), { recursive: true });
for (const unit of units) {
  const source = new URL(`./${unit}`, import.meta.url);
  const target = join(unitDir, basename(unit));
  const partial = `${target}.new`;
  await writeFile(partial, await readFile(source, "utf8"), { mode: 0o644 });
  await rename(partial, target);
}
await run("/usr/bin/systemctl", ["--user", "daemon-reload"]);
await run("/usr/bin/systemctl", ["--user", "enable", "--now", "home-gpu-work-graph.timer"]);
const status = await run("/usr/bin/systemctl", ["--user", "show", "home-gpu-work-graph.timer", "-p", "ActiveState", "-p", "SubState", "-p", "NextElapseUSecRealtime", "--no-pager"]);
console.log(JSON.stringify({ ok: true, timer: "home-gpu-work-graph.timer", status: status.stdout.trim() }, null, 2));
