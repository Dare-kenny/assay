import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const RAW_DIR = resolve(ROOT, "data", "raw");
export const DATA_DIR = resolve(ROOT, "data");

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readJsonOr<T>(path: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(path);
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown, pretty = true): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(value, null, pretty ? 1 : undefined) + "\n";
  await writeFile(path, text, "utf8");
  return sha256(text);
}

export type ManifestEntry = {
  file: string;
  source: string;
  url: string;
  fetchedAt: string;
  bytes: number;
  sha256: string;
  /** "fresh" = downloaded in this run; "kept" = download failed, last good copy retained */
  status: "fresh" | "kept";
  note?: string;
};

export const log = (msg: string) => process.stdout.write(`[assay] ${msg}\n`);
