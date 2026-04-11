import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import type { Entity } from "@packages/core";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(here, "..", "..", "..", "..", "data", "verity-graph.sqlite");

let dbSingleton: Database | null = null;

export function getGraphDatabasePath(): string {
  return process.env.VERITY_GRAPH_DB?.trim() || DEFAULT_DB_PATH;
}

export function getGraphDatabase(): Database {
  if (dbSingleton) return dbSingleton;
  const path = getGraphDatabasePath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(`
    CREATE TABLE IF NOT EXISTS graph_entities (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      relation TEXT NOT NULL,
      confidence REAL NOT NULL,
      session_id TEXT NOT NULL,
      claim_ids_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_graph_edges_session ON graph_edges(session_id);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_key);`);
  dbSingleton = db;
  return db;
}

function entityKey(e: Entity): string {
  return `${e.type}:${e.name.trim().toLowerCase()}`;
}

export function upsertEntities(entities: Entity[]): void {
  if (entities.length === 0) return;
  const db = getGraphDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO graph_entities (key, name, type, created_at, updated_at)
    VALUES (@key, @name, @type, @now, @now)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `);
  for (const e of entities) {
    stmt.run({ key: entityKey(e), name: e.name, type: e.type, now });
  }
}

export function insertEdges(
  sessionId: string,
  edges: Array<{
    fromKey: string;
    toKey: string;
    relation: string;
    confidence: number;
    claimIds: string[];
  }>,
): void {
  if (edges.length === 0) return;
  const db = getGraphDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO graph_edges (from_key, to_key, relation, confidence, session_id, claim_ids_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const e of edges) {
    stmt.run(
      e.fromKey,
      e.toKey,
      e.relation,
      e.confidence,
      sessionId,
      JSON.stringify(e.claimIds),
      now,
    );
  }
}

export function sessionEdgeSummary(sessionId: string, entityKeys: string[]): string {
  if (entityKeys.length === 0) return "";
  const db = getGraphDatabase();
  const placeholders = entityKeys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT from_key, to_key, relation, confidence, claim_ids_json FROM graph_edges
       WHERE session_id = ? AND (from_key IN (${placeholders}) OR to_key IN (${placeholders}))`,
    )
    .all(sessionId, ...entityKeys, ...entityKeys) as Array<{
    from_key: string;
    to_key: string;
    relation: string;
    confidence: number;
    claim_ids_json: string | null;
  }>;

  if (rows.length === 0) return "";

  const lines = rows.map((r) => {
    const ids = r.claim_ids_json ? JSON.parse(r.claim_ids_json) as string[] : [];
    const claimPart = ids.length ? ` (claims: ${ids.join(", ")})` : "";
    return `- ${r.from_key} —[${r.relation}, conf ${r.confidence.toFixed(2)}]→ ${r.to_key}${claimPart}`;
  });
  return lines.join("\n");
}

export { entityKey };
