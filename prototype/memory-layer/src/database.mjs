import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export function openMemoryDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      owner TEXT NOT NULL,
      privacy TEXT NOT NULL,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      authority REAL NOT NULL DEFAULT 0.5,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(namespace, source_uri, content_sha256)
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      namespace TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL,
      embedding_json TEXT,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      UNIQUE(document_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS chunks_namespace_idx ON chunks(namespace);
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(namespace, type, canonical_name)
    );
    CREATE TABLE IF NOT EXISTS chunk_entities (
      chunk_id TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      confidence REAL NOT NULL DEFAULT 1,
      PRIMARY KEY(chunk_id, entity_id)
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      source_entity_id TEXT NOT NULL REFERENCES entities(id),
      relation TEXT NOT NULL,
      target_entity_id TEXT NOT NULL REFERENCES entities(id),
      evidence_chunk_id TEXT NOT NULL REFERENCES chunks(id),
      confidence REAL NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL,
      superseded_by TEXT REFERENCES edges(id)
    );
    CREATE INDEX IF NOT EXISTS edges_namespace_idx ON edges(namespace);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      principal TEXT NOT NULL,
      action TEXT NOT NULL,
      namespace TEXT,
      object_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  return database;
}
