import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

export type AssetRecord = {
  path: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
};

type AssetManifest = {
  version: 1;
  projectId: string;
  assets: Record<string, AssetRecord>;
};

const MANIFEST = "manifest.json";
const FILES_DIR = "files";

function storeRoot(): string {
  return path.resolve(process.env.REMOTION_ASSET_STORE_DIR ?? path.join(os.tmpdir(), "remotion-ultimate-assets"));
}

function assertProjectId(projectId: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(projectId)) throw new Error("Invalid projectId for asset store.");
  return projectId;
}

export function normalizeAssetPath(input: string): string {
  const slash = input.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(slash);
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Invalid asset path: ${input}`);
  }
  if (normalized === MANIFEST || normalized.startsWith(`${MANIFEST}/`)) throw new Error("Reserved asset path.");
  return normalized;
}

function projectDir(projectId: string): string {
  return path.join(storeRoot(), assertProjectId(projectId));
}

function manifestPath(projectId: string): string {
  return path.join(projectDir(projectId), MANIFEST);
}

function filesDir(projectId: string): string {
  return path.join(projectDir(projectId), FILES_DIR);
}

function filePath(projectId: string, assetPath: string): string {
  const rel = normalizeAssetPath(assetPath);
  const root = path.resolve(filesDir(projectId));
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`Unsafe asset path: ${assetPath}`);
  return resolved;
}

function inferContentType(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
    ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".hdr": "application/octet-stream", ".exr": "image/x-exr",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
  };
  return map[ext] ?? "application/octet-stream";
}

async function readManifest(projectId: string): Promise<AssetManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath(projectId), "utf8")) as AssetManifest;
    if (parsed?.version === 1 && parsed.projectId === projectId && parsed.assets && typeof parsed.assets === "object") return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { version: 1, projectId, assets: {} };
}

async function writeManifest(projectId: string, manifest: AssetManifest): Promise<void> {
  const dir = projectDir(projectId);
  await fs.mkdir(dir, { recursive: true });
  const target = manifestPath(projectId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(temp, target);
}

class AssetStore {
  async put(projectId: string, assetPath: string, data: Buffer, contentType?: string): Promise<AssetRecord> {
    const logicalPath = normalizeAssetPath(assetPath);
    const max = Number(process.env.REMOTION_MAX_ASSET_BYTES ?? 256 * 1024 * 1024);
    if (data.length > max) throw new Error(`Asset exceeds REMOTION_MAX_ASSET_BYTES (${max} bytes).`);
    const target = filePath(projectId, logicalPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);

    const manifest = await readManifest(projectId);
    const previous = manifest.assets[logicalPath];
    const now = new Date().toISOString();
    const record: AssetRecord = {
      path: logicalPath,
      contentType: contentType?.trim() || inferContentType(logicalPath),
      size: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    manifest.assets[logicalPath] = record;
    await writeManifest(projectId, manifest);
    return record;
  }

  async list(projectId: string): Promise<AssetRecord[]> {
    const manifest = await readManifest(projectId);
    return Object.values(manifest.assets).sort((a, b) => a.path.localeCompare(b.path));
  }

  async get(projectId: string, assetPath: string): Promise<(AssetRecord & { filePath: string }) | null> {
    const logicalPath = normalizeAssetPath(assetPath);
    const manifest = await readManifest(projectId);
    const record = manifest.assets[logicalPath];
    if (!record) return null;
    const storedPath = filePath(projectId, logicalPath);
    try {
      await fs.access(storedPath);
    } catch {
      return null;
    }
    return { ...record, filePath: storedPath };
  }

  async delete(projectId: string, assetPath: string): Promise<boolean> {
    const logicalPath = normalizeAssetPath(assetPath);
    const manifest = await readManifest(projectId);
    if (!manifest.assets[logicalPath]) return false;
    delete manifest.assets[logicalPath];
    await fs.rm(filePath(projectId, logicalPath), { force: true });
    await writeManifest(projectId, manifest);
    return true;
  }

  async materializePublic(projectId: string, publicDir: string): Promise<number> {
    const assets = await this.list(projectId);
    for (const asset of assets) {
      const source = filePath(projectId, asset.path);
      const target = path.resolve(publicDir, asset.path);
      const root = path.resolve(publicDir) + path.sep;
      if (!target.startsWith(root)) throw new Error(`Unsafe materialized asset path: ${asset.path}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    }
    return assets.length;
  }

  async purgeProject(projectId: string): Promise<void> {
    await fs.rm(projectDir(projectId), { recursive: true, force: true });
  }
}

export const assetStore = new AssetStore();
