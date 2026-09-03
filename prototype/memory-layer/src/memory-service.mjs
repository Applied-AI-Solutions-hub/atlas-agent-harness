import { randomUUID } from "node:crypto";
import { chunkText, cosineSimilarity, estimateTokens, sha256, tokenize } from "./text.mjs";

function clamp(value, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function isoNow() {
  return new Date().toISOString();
}

function recencyScore(observedAt) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(observedAt)) / 86_400_000);
  return Math.exp(-ageDays / 365);
}

function bm25Scores(queryTokens, rows) {
  if (!queryTokens.length || !rows.length) return new Map();
  const tokenized = rows.map(row => tokenize(row.text));
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / tokenized.length || 1;
  const documentFrequency = new Map();
  for (const tokens of tokenized) {
    for (const token of new Set(tokens)) documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
  }
  const scores = new Map();
  const k1 = 1.2;
  const b = 0.75;
  rows.forEach((row, index) => {
    const tokens = tokenized[index];
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    let score = 0;
    for (const token of queryTokens) {
      const frequency = counts.get(token) || 0;
      if (!frequency) continue;
      const matches = documentFrequency.get(token) || 0;
      const idf = Math.log(1 + (rows.length - matches + 0.5) / (matches + 0.5));
      score += idf * ((frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * tokens.length / averageLength)));
    }
    scores.set(row.id, score);
  });
  return scores;
}

export class MemoryService {
  constructor({ database, embeddingQueue = null, queryEmbedder = null } = {}) {
    this.database = database;
    this.embeddingQueue = embeddingQueue;
    this.queryEmbedder = queryEmbedder;
  }

  audit(principal, action, namespace, objectId, details = {}) {
    this.database.prepare(`
      INSERT INTO audit_log (occurred_at, principal, action, namespace, object_id, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(isoNow(), principal, action, namespace || null, objectId || null, JSON.stringify(details));
  }

  ingest(input, principal = "system") {
    const namespace = String(input.namespace || "").trim();
    const text = String(input.text || "").trim();
    if (!namespace || !text) throw new Error("namespace and text are required");
    const source = input.source || {};
    if (!source.uri || !source.type) throw new Error("source.uri and source.type are required");
    const privacy = input.privacy || "private";
    const owner = input.owner || principal;
    const contentHash = sha256(text);
    const existing = this.database.prepare(`
      SELECT id FROM documents WHERE namespace = ? AND source_uri = ? AND content_sha256 = ?
    `).get(namespace, source.uri, contentHash);
    if (existing) return { documentId: existing.id, duplicate: true, chunkIds: [] };

    const documentId = randomUUID();
    const pieces = chunkText(text, input.chunking);
    const chunks = pieces.map((piece, ordinal) => ({
      id: randomUUID(), documentId, namespace, ordinal, text: piece,
      tokenEstimate: estimateTokens(piece), contentHash: sha256(piece)
    }));
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        INSERT INTO documents
        (id, namespace, owner, privacy, title, source_type, source_uri, observed_at, ingested_at, content_sha256, authority, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        documentId, namespace, owner, privacy, source.title || source.uri, source.type, source.uri,
        source.observedAt || isoNow(), isoNow(), contentHash, clamp(Number(input.authority ?? 0.5), 0, 1),
        JSON.stringify(input.metadata || {})
      );
      const insertChunk = this.database.prepare(`
        INSERT INTO chunks (id, document_id, namespace, ordinal, text, token_estimate, content_sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chunk of chunks) insertChunk.run(chunk.id, documentId, namespace, chunk.ordinal, chunk.text, chunk.tokenEstimate, chunk.contentHash);
      for (const entity of input.entities || []) this.#linkEntityToMatchingChunks(namespace, entity, chunks);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.audit(principal, "ingest", namespace, documentId, { chunks: chunks.length, sourceUri: source.uri });
    this.embeddingQueue?.enqueue(chunks);
    return { documentId, duplicate: false, chunkIds: chunks.map(chunk => chunk.id) };
  }

  #ensureEntity(namespace, entity) {
    const type = String(entity.type || "concept").trim().toLowerCase();
    const name = String(entity.name || "").trim();
    if (!name) throw new Error("entity.name is required");
    const existing = this.database.prepare(`
      SELECT id FROM entities WHERE namespace = ? AND type = ? AND canonical_name = ?
    `).get(namespace, type, name);
    if (existing) return existing.id;
    const id = randomUUID();
    this.database.prepare(`
      INSERT INTO entities (id, namespace, type, canonical_name, created_at) VALUES (?, ?, ?, ?, ?)
    `).run(id, namespace, type, name, isoNow());
    return id;
  }

  #linkEntityToMatchingChunks(namespace, entity, chunks) {
    const entityId = this.#ensureEntity(namespace, entity);
    const names = [entity.name, ...(entity.aliases || [])].map(value => String(value).toLowerCase());
    const insert = this.database.prepare(`
      INSERT OR IGNORE INTO chunk_entities (chunk_id, entity_id, confidence) VALUES (?, ?, ?)
    `);
    for (const chunk of chunks) {
      const lower = chunk.text.toLowerCase();
      if (names.some(name => name && lower.includes(name))) insert.run(chunk.id, entityId, clamp(Number(entity.confidence ?? 1), 0, 1));
    }
    return entityId;
  }

  addEdge(input, principal = "system") {
    const namespace = String(input.namespace || "").trim();
    if (!namespace || !input.evidenceChunkId || !input.relation) throw new Error("namespace, relation, and evidenceChunkId are required");
    const evidence = this.database.prepare("SELECT id FROM chunks WHERE id = ? AND namespace = ?").get(input.evidenceChunkId, namespace);
    if (!evidence) throw new Error("evidence chunk is not in the requested namespace");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const sourceId = this.#ensureEntity(namespace, input.source);
      const targetId = this.#ensureEntity(namespace, input.target);
      const id = randomUUID();
      this.database.prepare(`
        INSERT INTO edges
        (id, namespace, source_entity_id, relation, target_entity_id, evidence_chunk_id, confidence, valid_from, valid_to, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, namespace, sourceId, input.relation, targetId, input.evidenceChunkId,
        clamp(Number(input.confidence ?? 1), 0, 1), input.validFrom || null, input.validTo || null, isoNow());
      this.database.prepare("INSERT OR IGNORE INTO chunk_entities VALUES (?, ?, ?)").run(input.evidenceChunkId, sourceId, 1);
      this.database.prepare("INSERT OR IGNORE INTO chunk_entities VALUES (?, ?, ?)").run(input.evidenceChunkId, targetId, 1);
      this.database.exec("COMMIT");
      this.audit(principal, "graph.write", namespace, id, { relation: input.relation, evidenceChunkId: input.evidenceChunkId });
      return { edgeId: id };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async search(input, principal = "system") {
    const query = String(input.query || "").trim();
    const namespaces = [...new Set((input.namespaces || []).map(value => String(value).trim()).filter(Boolean))];
    if (!query || !namespaces.length) throw new Error("query and namespaces are required");
    const placeholders = namespaces.map(() => "?").join(",");
    const rows = this.database.prepare(`
      SELECT c.id, c.document_id, c.namespace, c.ordinal, c.text, c.token_estimate, c.embedding_json,
             d.title, d.source_type, d.source_uri, d.observed_at, d.authority, d.metadata_json
      FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.namespace IN (${placeholders})
    `).all(...namespaces);
    const lexical = bm25Scores(tokenize(query), rows);
    const maxLexical = Math.max(0, ...lexical.values());
    let queryEmbedding = null;
    if (this.queryEmbedder) {
      try { queryEmbedding = await this.queryEmbedder(query, "query"); } catch { queryEmbedding = null; }
    }
    let scored = rows.map(row => {
      const embedding = parseJson(row.embedding_json, null);
      const lexicalScore = maxLexical ? (lexical.get(row.id) || 0) / maxLexical : 0;
      const semanticScore = queryEmbedding && embedding ? Math.max(0, cosineSimilarity(queryEmbedding, embedding)) : 0;
      const score = 0.68 * lexicalScore + 0.22 * semanticScore + 0.06 * row.authority + 0.04 * recencyScore(row.observed_at);
      return { ...row, lexicalScore, semanticScore, score, graphReason: null };
    }).filter(row => row.lexicalScore > 0 || row.semanticScore > 0);

    scored.sort((left, right) => right.score - left.score);
    if (input.includeGraph !== false) scored = this.#expandGraph(scored, rows);
    const topK = clamp(Number(input.topK ?? 6), 1, 20);
    const tokenBudget = clamp(Number(input.tokenBudget ?? 1500), 128, 8000);
    const results = [];
    let usedTokens = 0;
    for (const row of scored.slice(0, topK * 3)) {
      if (results.length >= topK || usedTokens >= tokenBudget) break;
      const remaining = tokenBudget - usedTokens;
      const excerptChars = Math.max(0, remaining * 4 - 240);
      if (excerptChars < 80) break;
      const excerpt = row.text.length > excerptChars ? `${row.text.slice(0, excerptChars - 1)}…` : row.text;
      const tokens = estimateTokens(excerpt) + 60;
      usedTokens += tokens;
      results.push({
        chunkId: row.id,
        documentId: row.document_id,
        namespace: row.namespace,
        excerpt,
        score: Number(row.score.toFixed(4)),
        scoreBreakdown: {
          lexical: Number(row.lexicalScore.toFixed(4)),
          semantic: Number(row.semanticScore.toFixed(4)),
          graph: row.graphReason ? 1 : 0
        },
        graphReason: row.graphReason,
        source: {
          title: row.title,
          type: row.source_type,
          uri: row.source_uri,
          observedAt: row.observed_at,
          authority: row.authority,
          metadata: parseJson(row.metadata_json, {})
        }
      });
    }
    this.audit(principal, "search", namespaces.join(","), null, { queryHash: sha256(query), resultCount: results.length, tokenBudget, usedTokens });
    return { query, namespaces, tokenBudget, estimatedTokens: usedTokens, results };
  }

  #expandGraph(scored, allRows) {
    const seedIds = scored.slice(0, 4).map(row => row.id);
    if (!seedIds.length) return scored;
    const placeholders = seedIds.map(() => "?").join(",");
    const neighbors = this.database.prepare(`
      SELECT DISTINCT ce2.chunk_id, e1.canonical_name AS source_name, ed.relation, e2.canonical_name AS target_name
      FROM chunk_entities ce1
      JOIN edges ed ON ed.source_entity_id = ce1.entity_id OR ed.target_entity_id = ce1.entity_id
      JOIN entities e1 ON e1.id = ed.source_entity_id
      JOIN entities e2 ON e2.id = ed.target_entity_id
      JOIN chunk_entities ce2 ON ce2.entity_id IN (ed.source_entity_id, ed.target_entity_id)
      WHERE ce1.chunk_id IN (${placeholders}) AND ed.superseded_by IS NULL
    `).all(...seedIds);
    const byId = new Map(scored.map(row => [row.id, row]));
    const allById = new Map(allRows.map(row => [row.id, row]));
    for (const neighbor of neighbors) {
      const row = byId.get(neighbor.chunk_id) || allById.get(neighbor.chunk_id);
      if (!row) continue;
      const reason = `${neighbor.source_name} —${neighbor.relation}→ ${neighbor.target_name}`;
      if (byId.has(row.id)) {
        row.score += 0.08;
        row.graphReason ||= reason;
      } else {
        byId.set(row.id, { ...row, lexicalScore: 0, semanticScore: 0, score: 0.08, graphReason: reason });
      }
    }
    return [...byId.values()].sort((left, right) => right.score - left.score);
  }
}
