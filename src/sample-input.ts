import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT, config } from "./config.ts";

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** SAMPLE_MODE reads input_examples only. Output files are never loaded. Calls are not stubbed here. */
export function resolveRunInput(
  fileArg: string,
  opts?: { sampleMode?: boolean; root?: string },
): string {
  const root = opts?.root ?? PROJECT_ROOT;
  const sampleMode = opts?.sampleMode ?? config.sampleMode;
  const full = path.resolve(fileArg);
  const inputs = path.resolve(root, "input_examples");
  const outputs = path.resolve(root, "output_examples");
  if (inside(outputs, full)) throw new Error("output examples are never loaded");
  if (sampleMode && !inside(inputs, full)) throw new Error("SAMPLE_MODE loads files from input_examples only");
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error("input file not found");
  return full;
}
