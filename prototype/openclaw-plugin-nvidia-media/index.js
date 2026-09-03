import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MODEL = "nemotron-asr-streaming";
const DEFAULT_FUNCTION_ID = "bb0837de-8c7b-481f-9ec8-ef5663e9c1fa";
const DEFAULT_PYTHON = "/home/openclaw/.local/share/nvidia-riva-venv/bin/python";
const BRIDGE_PATH = fileURLToPath(new URL("./asr_bridge.py", import.meta.url));
const MAX_OUTPUT_BYTES = 1024 * 1024;

function runBridge({ pythonPath, inputPath, apiKey, functionId, language, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [BRIDGE_PATH, inputPath], {
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        NVIDIA_API_KEY: apiKey,
        NVIDIA_NVCF_FUNCTION_ID: functionId,
        NVIDIA_ASR_LANGUAGE: language || "en-US"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", reject);
    child.on("close", async code => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("NVIDIA ASR request aborted"));
      if (code !== 0) {
        const diagnostic = stderr.trim() || "no diagnostic output";
        await appendFile("/tmp/atlas-nvidia-asr-errors.log", `${new Date().toISOString()} ${diagnostic}\n`, { mode: 0o600 }).catch(() => {});
        return reject(new Error(`NVIDIA ASR failed (${code}): ${diagnostic}`));
      }
      const text = stdout.trim();
      if (!text) return reject(new Error("NVIDIA ASR returned an empty transcript"));
      resolve(text);
    });
  });
}

export default definePluginEntry({
  id: "atlas-nvidia-media",
  name: "Atlas NVIDIA Media",
  description: "Official NVIDIA Riva-backed media understanding for Atlas",
  register(api) {
    const config = api.pluginConfig || {};
    api.registerMediaUnderstandingProvider({
      id: "nvidia",
      capabilities: ["audio"],
      defaultModels: { audio: DEFAULT_MODEL },
      autoPriority: { audio: 10 },
      async transcribeAudio(request) {
        const suffix = /^\.[a-z0-9]{1,8}$/i.test(extname(request.fileName || "")) ? extname(request.fileName) : ".audio";
        const directory = await mkdtemp(join(tmpdir(), "atlas-nvidia-asr-"));
        const inputPath = join(directory, `${basename(request.fileName || "audio", extname(request.fileName || ""))}${suffix}`);
        try {
          await writeFile(inputPath, request.buffer, { mode: 0o600 });
          const text = await runBridge({
            pythonPath: config.pythonPath || DEFAULT_PYTHON,
            inputPath,
            apiKey: request.apiKey,
            functionId: config.asrFunctionId || DEFAULT_FUNCTION_ID,
            language: request.language,
            signal: request.signal
          });
          return { text, model: request.model || DEFAULT_MODEL };
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      }
    });
  }
});
