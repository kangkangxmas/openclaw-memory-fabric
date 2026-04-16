/**
 * JSONL (newline-delimited JSON) read/write helpers.
 *
 * Used by OpenVikingService and SharedService to persist memory entries
 * without requiring a database.
 */
import { readFile, writeFile, appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function appendJsonl<T>(filePath: string, entry: T): Promise<void> {
  await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
}

export async function writeJsonl<T>(filePath: string, entries: T[]): Promise<void> {
  await writeFile(filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

export async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

export async function ensureFileDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}
