import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type OutputRecord = {
  id: string;
  filePath: string;
  fileName: string;
  contentType: string;
  createdAt: string;
};

const outputs = new Map<string, OutputRecord>();
const MAX_OUTPUTS = 100;

export function outputDirectory(): string {
  return path.resolve(process.env.REMOTION_OUTPUT_DIR ?? path.join(os.tmpdir(), "remotion-ultimate-outputs"));
}

export async function registerOutput(filePath: string, contentType: string): Promise<OutputRecord> {
  const id = randomUUID();
  const record: OutputRecord = {
    id,
    filePath: path.resolve(filePath),
    fileName: path.basename(filePath),
    contentType,
    createdAt: new Date().toISOString(),
  };
  outputs.set(id, record);
  while (outputs.size > MAX_OUTPUTS) {
    const oldest = outputs.keys().next().value;
    if (typeof oldest !== "string") break;
    const old = outputs.get(oldest);
    outputs.delete(oldest);
    if (old) void fs.rm(old.filePath, { force: true }).catch(() => undefined);
  }
  return record;
}

export function getOutput(id: string): OutputRecord | null {
  return outputs.get(id) ?? null;
}

export function outputUrl(record: OutputRecord): string {
  const relative = `/renders/${record.id}/${encodeURIComponent(record.fileName)}`;
  const base = process.env.REMOTION_PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}${relative}` : relative;
}
