import fs from "node:fs";
import path from "node:path";

const ALLOWED = new Set([".html", ".css", ".js", ".svg"]);

export function publicFile(root: string, urlPath: string): string | null {
  let rel = urlPath === "/" ? "index.html" : urlPath;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  rel = rel.replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED.has(ext)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

export function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/html; charset=utf-8";
  }
}
