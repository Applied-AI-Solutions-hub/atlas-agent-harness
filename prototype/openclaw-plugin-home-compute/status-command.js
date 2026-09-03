import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";

const COMMAND = "atlas.compute.status";
const MAX_OUTPUT_BYTES = 4096;
const QUERY_ARGS = [
  "--query-gpu=name,memory.total,driver_version,compute_cap,utilization.gpu",
  "--format=csv,noheader,nounits"
];

function parseEmptyParams(paramsJSON) {
  if (paramsJSON == null || paramsJSON.trim() === "") return {};
  let value;
  try {
    value = JSON.parse(paramsJSON);
  } catch {
    throw new Error("INVALID_REQUEST: params must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new Error("INVALID_REQUEST: atlas.compute.status accepts no properties");
  }
  return value;
}

async function isExecutable(candidate) {
  try {
    await access(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveNvidiaSmi(_env = process.env, probe = isExecutable) {
  const candidates = [
    "/usr/lib/wsl/lib/nvidia-smi",
    "/usr/bin/nvidia-smi",
    "/usr/local/bin/nvidia-smi"
  ];
  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate;
  }
  return null;
}

function runExactCommand(executable, args, { signal, timeoutMs = 5000, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: maxOutputBytes,
      signal,
      env: { PATH: process.env.PATH || "", LC_ALL: "C", LANG: "C" },
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        const code = error.killed || error.signal ? "GPU_PROBE_TIMEOUT" : "GPU_PROBE_FAILED";
        reject(new Error(`${code}: nvidia-smi did not return an accepted status`));
        return;
      }
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes || Buffer.byteLength(stderr, "utf8") > maxOutputBytes) {
        reject(new Error("GPU_PROBE_OUTPUT_LIMIT: nvidia-smi output exceeded the bound"));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseGpuStatus(stdout) {
  const lines = stdout.trim().split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) throw new Error("GPU_PROBE_INVALID: exactly one GPU is required");
  const fields = lines[0].split(",").map(value => value.trim());
  if (fields.length !== 5) throw new Error("GPU_PROBE_INVALID: unexpected nvidia-smi response");
  const [name, memoryText, driverVersion, computeCapability, utilizationText] = fields;
  const memoryMiB = Number(memoryText);
  const utilizationPercent = Number(utilizationText);
  if (!name.includes("RTX 5060 Ti") || !Number.isInteger(memoryMiB) || memoryMiB < 16000 ||
      computeCapability !== "12.0" || !Number.isFinite(utilizationPercent) ||
      utilizationPercent < 0 || utilizationPercent > 100) {
    throw new Error("GPU_PROBE_REJECTED: GPU does not match the approved home worker");
  }
  if (!/^\d+(?:\.\d+)+$/u.test(driverVersion)) {
    throw new Error("GPU_PROBE_INVALID: driver version is malformed");
  }
  return { name, memoryMiB, driverVersion, computeCapability, utilizationPercent };
}

function createStatusCommand({
  platform = process.platform,
  env = process.env,
  resolveExecutable = resolveNvidiaSmi,
  runCommand = runExactCommand,
  enabled = true
} = {}) {
  let executable = null;
  return {
    command: COMMAND,
    cap: "atlas-compute",
    async prepare(context) {
      if (platform === "linux" && enabled) executable = await resolveExecutable(context.env || env);
    },
    isAvailable() {
      return platform === "linux" && enabled && executable !== null;
    },
    async handle(paramsJSON, io) {
      parseEmptyParams(paramsJSON);
      if (platform !== "linux" || !enabled) throw new Error("HOME_COMPUTE_DISABLED: Linux home worker is required");
      if (!executable) throw new Error("GPU_PROBE_UNAVAILABLE: nvidia-smi was not found");
      const result = await runCommand(executable, QUERY_ARGS, { signal: io?.signal, timeoutMs: 5000, maxOutputBytes: MAX_OUTPUT_BYTES });
      const gpu = parseGpuStatus(result.stdout);
      return JSON.stringify({
        ok: true,
        workerId: "home-gpu",
        capabilities: ["compute-status"],
        gpu,
        asr: { status: "not-installed" },
        containsSecrets: false
      });
    }
  };
}

export { COMMAND, MAX_OUTPUT_BYTES, QUERY_ARGS, createStatusCommand, parseEmptyParams, parseGpuStatus, resolveNvidiaSmi, runExactCommand };
