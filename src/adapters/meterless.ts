import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadHMEM } from "../engine.ts";
import { PROJECT_ROOT } from "../config.ts";
import { memoryFacts } from "../data/seed.ts";

type HmemInstance = {
  add: (input: { content: string; type?: string; source: string; tags?: string[] }) => { id: string; content: string };
  query: (
    query: string,
    opts?: { topN?: number; threshold?: number },
  ) => {
    memories: { memory: { id: string; content: string }; relevance: number }[];
    context: string;
  };
};

let instance: HmemInstance | null = null;
let sourceLabel = "";

const PERSIST_FILES = ["state.json", "ledger.jsonl"];
const DATASET_MARKER = "dataset-version.txt";

export function memoryDatasetFingerprint(facts: { content: string }[]): string {
  return createHash("sha256").update(facts.map((fact) => fact.content).join("\n")).digest("hex");
}

/**
 * The H-MEM class exposes add and query, not delete. When the synthetic
 * dataset changes, drop the persist files before the first load so older
 * records are not treated as current.
 */
export function resetStaleHmem(dir: string, fingerprint: string): boolean {
  fs.mkdirSync(dir, { recursive: true });
  const markerPath = path.join(dir, DATASET_MARKER);
  const current = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : "";
  if (current === fingerprint) return false;
  for (const name of PERSIST_FILES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  return true;
}

export function writeDatasetMarker(dir: string, fingerprint: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, DATASET_MARKER), `${fingerprint}\n`);
}

export async function getHmem(): Promise<{ hmem: HmemInstance; source: string }> {
  if (instance) return { hmem: instance, source: sourceLabel };
  const loaded = await loadHMEM();
  const persistDir = path.join(PROJECT_ROOT, "data", "hmem");
  resetStaleHmem(persistDir, memoryDatasetFingerprint(memoryFacts()));
  instance = new loaded.HMEM({ persistDir, actor: "vesper-d1" }) as HmemInstance;
  sourceLabel = loaded.source;
  return { hmem: instance, source: sourceLabel };
}

export interface MemoryHit {
  id: string;
  content: string;
  relevance: number;
}

export async function rememberIncident(
  content: string,
  tags: string[],
  source = "d2-seed:synthetic",
): Promise<{ id: string }> {
  const { hmem } = await getHmem();
  const record = hmem.add({
    content,
    type: "factual",
    source,
    tags,
  });
  return { id: record.id };
}

let seeded = false;

export async function seedIncidents(facts: { content: string; tags: string[] }[]): Promise<void> {
  if (seeded) return;
  const persistDir = path.join(PROJECT_ROOT, "data", "hmem");
  const fingerprint = memoryDatasetFingerprint(facts);
  const existing = await queryIncidents("D3 synthetic ISS-001 SSA-001");
  if (existing.some((h) => h.content.includes("D3 synthetic"))) {
    writeDatasetMarker(persistDir, fingerprint);
    seeded = true;
    return;
  }
  for (const fact of facts) {
    await rememberIncident(fact.content, fact.tags, "d3-seed:synthetic");
  }
  writeDatasetMarker(persistDir, fingerprint);
  seeded = true;
}

export async function queryIncidents(query: string): Promise<MemoryHit[]> {
  const { hmem } = await getHmem();
  const result = hmem.query(query, { topN: 20, threshold: 0.05 });
  return result.memories.map((row) => ({
    id: row.memory.id,
    content: row.memory.content,
    relevance: row.relevance,
  }));
}

export async function meterlessStatus(): Promise<{ ok: boolean; source: string }> {
  try {
    const { source } = await getHmem();
    return { ok: true, source };
  } catch {
    return { ok: false, source: "unavailable" };
  }
}
