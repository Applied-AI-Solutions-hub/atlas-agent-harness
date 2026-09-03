export function createOpenAICompatibleEmbedder({ baseUrl, apiKey, model, timeoutMs = 1500, dimensions } = {}) {
  if (!baseUrl || !model) return null;
  return async function embed(input, inputType) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ model, input, input_type: inputType, ...(dimensions ? { dimensions } : {}) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`embedding endpoint returned HTTP ${response.status}`);
    const payload = await response.json();
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) throw new Error("embedding endpoint returned no vector");
    return vector;
  };
}

export class EmbeddingQueue {
  #pending = [];
  #running = false;

  constructor({ embed, database }) {
    this.embed = embed;
    this.database = database;
  }

  enqueue(chunks) {
    if (!this.embed) return;
    this.#pending.push(...chunks);
    this.#drain();
  }

  status() {
    return { enabled: Boolean(this.embed), queued: this.#pending.length, running: this.#running };
  }

  async #drain() {
    if (this.#running) return;
    this.#running = true;
    const update = this.database.prepare("UPDATE chunks SET embedding_json = ?, embedding_status = ? WHERE id = ?");
    try {
      while (this.#pending.length) {
        const chunk = this.#pending.shift();
        try {
          const vector = await this.embed(chunk.text, "passage");
          update.run(JSON.stringify(vector), "ready", chunk.id);
        } catch {
          update.run(null, "failed", chunk.id);
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      this.#running = false;
    }
  }
}
