import { readFile } from "node:fs/promises";

export function createWorkGraphClient({ baseUrl, tokenFile, namespace, timeoutMs = 1500, fetchImpl = fetch }) {
  async function token() {
    const value = (await readFile(tokenFile, "utf8")).trim();
    if (!value) throw new Error("Work-graph token file is empty");
    return value;
  }

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${await token()}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Work graph returned HTTP ${response.status}`);
    return payload;
  }

  return {
    submit(input) {
      return request("/v1/jobs", { method: "POST", body: { namespace, ...input } });
    },
    status(jobId, includeResult = false) {
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(jobId)) throw new Error("Invalid job ID");
      return request(`/v1/jobs/${jobId}${includeResult ? "/result" : ""}`);
    },
  };
}
