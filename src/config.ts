import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

parseEnvFile(path.join(root, ".env"));

const REQUIRED = [
  "MODEL_BASE_URL",
  "MODEL_API_KEY",
  "NEMOTRON_MODEL",
  "ZETARIS_REST_URL",
  "ZETARIS_API_KEY",
  "ZETARIS_ORG_ID",
] as const;

export type EnvName = (typeof REQUIRED)[number];

function read(name: EnvName, fallback?: string): string {
  const value = process.env[name] ?? fallback ?? "";
  return value.trim();
}

export const PROJECT_ROOT = root;

export const config = {
  modelBaseUrl: read("MODEL_BASE_URL"),
  modelApiKey: read("MODEL_API_KEY"),
  /** Optional second key for the Evaluator model calls. Empty means the Evaluator shares MODEL_API_KEY. */
  /** Optional key for the Planner model call. Empty means the Planner shares MODEL_API_KEY. */
  plannerApiKey: (process.env.PLANNER_API_KEY ?? "").trim(),
  evaluatorApiKey: (process.env.EVALUATOR_API_KEY ?? "").trim(),
  nemotronModel: read("NEMOTRON_MODEL"),
  zetarisRestUrl: read("ZETARIS_REST_URL", "http://localhost:8888/api/v1.0"),
  zetarisApiKey: read("ZETARIS_API_KEY"),
  zetarisOrgId: read("ZETARIS_ORG_ID", "1"),
  sampleMode: (process.env.SAMPLE_MODE ?? "false").trim().toLowerCase() === "true",
};

export function envPresence(): Record<EnvName, boolean> {
  return {
    MODEL_BASE_URL: Boolean(config.modelBaseUrl),
    MODEL_API_KEY: Boolean(config.modelApiKey),
    NEMOTRON_MODEL: Boolean(config.nemotronModel),
    ZETARIS_REST_URL: Boolean(config.zetarisRestUrl),
    ZETARIS_API_KEY: Boolean(config.zetarisApiKey),
    ZETARIS_ORG_ID: Boolean(config.zetarisOrgId),
  };
}

export function missingEnv(): EnvName[] {
  return (Object.entries(envPresence()) as [EnvName, boolean][])
    .filter(([, present]) => !present)
    .map(([name]) => name);
}
