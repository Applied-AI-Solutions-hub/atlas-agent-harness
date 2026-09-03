import { readFile } from "node:fs/promises";

export function createMemoryClient({ baseUrl, tokenFile, namespaces, timeoutMs = 1500, maxEvidenceTokens = 1200, fetchImpl = fetch }) {
  const allowed = new Set(namespaces || []);

  async function token() {
    const value = (await readFile(tokenFile, "utf8")).trim();
    if (!value) throw new Error("Atlas memory token file is empty");
    return value;
  }

  async function request(path, body) {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await token()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Atlas memory returned HTTP ${response.status}`);
    return payload;
  }

  return {
    async health() {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Atlas memory health returned HTTP ${response.status}`);
      return response.json();
    },
    async search({ query, requestedNamespaces, topK = 5, tokenBudget = maxEvidenceTokens, includeGraph = true }) {
      const selected = requestedNamespaces?.length ? requestedNamespaces : [...allowed];
      if (!selected.length || selected.some(namespace => !allowed.has(namespace))) throw new Error("Requested memory namespace is not allowed for this agent");
      return request("/v1/search", {
        query,
        namespaces: selected,
        topK: Math.min(8, Math.max(1, topK)),
        tokenBudget: Math.min(maxEvidenceTokens, Math.max(128, tokenBudget)),
        includeGraph
      });
    }
  };
}
