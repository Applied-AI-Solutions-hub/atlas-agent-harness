#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { spawn } from "node:child_process";

const RELEASE = Object.freeze({
  version: "v0.33.2",
  url: "https://github.com/ollama/ollama/releases/download/v0.33.2/ollama-linux-amd64.tar.zst",
  sha256: "9785247dea264d9072f09f6c9c0eb4b8e666892826a3d8388eba3e8fb9ed1db9",
  maxBytes: 1_550_000_000,
});

const home = homedir();
const cacheDir = join(home, ".cache", "applied-ai", "ollama");
const archive = join(cacheDir, `ollama-linux-amd64-${RELEASE.version}.tar.zst`);
const versionsDir = join(home, ".local", "ollama", "versions");
const targetDir = join(versionsDir, RELEASE.version);
const binLink = join(home, ".local", "bin", "ollama");
const unitDir = join(home, ".config", "systemd", "user");
const unitTarget = join(unitDir, "ollama.service");
const unitSource = new URL("./ollama.service", import.meta.url);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code ?? signal}: ${stderr.trim()}`));
    });
  });
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadRelease() {
  if (await exists(archive)) {
    if ((await sha256(archive)) === RELEASE.sha256) return;
    await rm(archive);
  }

  const partial = `${archive}.partial`;
  await rm(partial, { force: true });
  const response = await fetch(RELEASE.url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Ollama download failed with HTTP ${response.status}.`);
  }
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (announced > RELEASE.maxBytes) throw new Error("Ollama archive exceeds the pinned size ceiling.");

  let received = 0;
  const limiter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > RELEASE.maxBytes) throw new Error("Ollama archive exceeded the size ceiling while downloading.");
      controller.enqueue(chunk);
    },
  });
  await pipeline(response.body.pipeThrough(limiter), createWriteStream(partial, { mode: 0o600 }));
  if ((await sha256(partial)) !== RELEASE.sha256) {
    await rm(partial, { force: true });
    throw new Error("Ollama archive checksum mismatch; the archive was removed.");
  }
  await rename(partial, archive);
}

async function extractRelease() {
  const executable = join(targetDir, "bin", "ollama");
  if (await exists(executable)) return;

  const stage = join(versionsDir, `.stage-${RELEASE.version}-${process.pid}`);
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const tar = spawn("/usr/bin/tar", ["-x", "-C", stage], { stdio: ["pipe", "pipe", "pipe"] });
  let tarError = "";
  tar.stderr.on("data", (chunk) => { tarError += chunk; });
  await Promise.all([
    pipeline(createReadStream(archive), createZstdDecompress(), tar.stdin),
    new Promise((resolve, reject) => {
      tar.on("error", reject);
      tar.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`tar extraction failed: ${tarError.trim()}`)));
    }),
  ]);
  if (!(await exists(join(stage, "bin", "ollama")))) {
    await rm(stage, { recursive: true, force: true });
    throw new Error("The extracted release does not contain bin/ollama.");
  }
  await rename(stage, targetDir);
  await chmod(executable, 0o755);
}

async function installLink() {
  await mkdir(dirname(binLink), { recursive: true });
  try {
    const current = await lstat(binLink);
    if (!current.isSymbolicLink()) throw new Error(`${binLink} exists and is not a symlink; refusing to replace it.`);
    await rm(binLink);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await symlink(join(targetDir, "bin", "ollama"), binLink);
}

async function installUnit() {
  await mkdir(unitDir, { recursive: true });
  const unit = await readFile(unitSource, "utf8");
  const partial = `${unitTarget}.new`;
  await writeFile(partial, unit, { mode: 0o644 });
  await rename(partial, unitTarget);
  await mkdir(join(home, ".local", "share", "ollama", "models"), { recursive: true });
  await mkdir(join(home, ".ollama"), { recursive: true, mode: 0o700 });
  await run("/usr/bin/systemctl", ["--user", "daemon-reload"]);
  await run("/usr/bin/systemctl", ["--user", "enable", "--now", "ollama.service"]);
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Ollama did not become healthy: ${lastError}`);
}

await mkdir(cacheDir, { recursive: true });
await mkdir(versionsDir, { recursive: true });
await downloadRelease();
await extractRelease();
await installLink();
await installUnit();
const health = await waitForHealth();

console.log(JSON.stringify({
  ok: true,
  version: RELEASE.version,
  serverVersion: health.version,
  endpoint: "http://127.0.0.1:11434",
  networkBoundary: "loopback-only",
  installRoot: targetDir,
}, null, 2));
