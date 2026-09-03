import test from "node:test";
import assert from "node:assert/strict";
import { createStatusCommand, parseEmptyParams, parseGpuStatus, resolveNvidiaSmi } from "./status-command.js";

test("parseEmptyParams accepts only an empty object", () => {
  assert.deepEqual(parseEmptyParams(null), {});
  assert.deepEqual(parseEmptyParams("{}"), {});
  assert.throws(() => parseEmptyParams('{"command":"id"}'), /accepts no properties/u);
  assert.throws(() => parseEmptyParams("nope"), /valid JSON/u);
});

test("parseGpuStatus accepts the approved home GPU", () => {
  assert.deepEqual(
    parseGpuStatus("NVIDIA GeForce RTX 5060 Ti, 16311, 595.79, 12.0, 7\n"),
    {
      name: "NVIDIA GeForce RTX 5060 Ti",
      memoryMiB: 16311,
      driverVersion: "595.79",
      computeCapability: "12.0",
      utilizationPercent: 7
    }
  );
});

test("parseGpuStatus rejects a different GPU or multiple GPUs", () => {
  assert.throws(() => parseGpuStatus("NVIDIA RTX 4090, 24564, 595.79, 8.9, 0\n"), /does not match/u);
  assert.throws(() => parseGpuStatus("NVIDIA GeForce RTX 5060 Ti, 16311, 595.79, 12.0, 0\nNVIDIA GeForce RTX 5060 Ti, 16311, 595.79, 12.0, 0\n"), /exactly one/u);
});

test("resolveNvidiaSmi returns the first executable candidate", async () => {
  const seen = [];
  const resolved = await resolveNvidiaSmi({ PATH: "/custom/bin" }, async candidate => {
    seen.push(candidate);
    return candidate === "/usr/bin/nvidia-smi";
  });
  assert.equal(resolved, "/usr/bin/nvidia-smi");
  assert.deepEqual(seen, ["/usr/lib/wsl/lib/nvidia-smi", "/usr/bin/nvidia-smi"]);
});

test("resolveNvidiaSmi ignores PATH-injected executables", async () => {
  const seen = [];
  const resolved = await resolveNvidiaSmi({ PATH: "/untrusted/bin" }, async candidate => {
    seen.push(candidate);
    return candidate === "/untrusted/bin/nvidia-smi";
  });
  assert.equal(resolved, null);
  assert.deepEqual(seen, [
    "/usr/lib/wsl/lib/nvidia-smi",
    "/usr/bin/nvidia-smi",
    "/usr/local/bin/nvidia-smi"
  ]);
});

test("status command advertises only after preparation and returns bounded structured status", async () => {
  const command = createStatusCommand({
    platform: "linux",
    enabled: true,
    resolveExecutable: async () => "/usr/lib/wsl/lib/nvidia-smi",
    runCommand: async (executable, args, options) => {
      assert.equal(executable, "/usr/lib/wsl/lib/nvidia-smi");
      assert.equal(args.length, 2);
      assert.equal(options.timeoutMs, 5000);
      assert.equal(options.maxOutputBytes, 4096);
      return { stdout: "NVIDIA GeForce RTX 5060 Ti, 16311, 595.79, 12.0, 3\n", stderr: "" };
    }
  });
  assert.equal(command.isAvailable(), false);
  await command.prepare({ env: { PATH: "/usr/bin" } });
  assert.equal(command.isAvailable(), true);
  const result = JSON.parse(await command.handle("{}", { signal: new AbortController().signal }));
  assert.equal(result.ok, true);
  assert.equal(result.workerId, "home-gpu");
  assert.deepEqual(result.capabilities, ["compute-status"]);
  assert.equal(result.asr.status, "not-installed");
  assert.equal(result.containsSecrets, false);
});

test("disabled command is not advertised or executable", async () => {
  const command = createStatusCommand({ platform: "linux", enabled: false });
  await command.prepare({ env: {} });
  assert.equal(command.isAvailable(), false);
  await assert.rejects(() => command.handle("{}"), /HOME_COMPUTE_DISABLED/u);
});
