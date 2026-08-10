import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectSnapshot } from "./types.js";

export type ProjectStore = {
  get(sessionId: string): Promise<ProjectSnapshot | null>;
  put(sessionId: string, project: Omit<ProjectSnapshot, "revision" | "createdAt" | "updatedAt"> & Partial<Pick<ProjectSnapshot, "revision" | "createdAt" | "updatedAt">>): Promise<ProjectSnapshot>;
  delete(sessionId: string): Promise<void>;
};

const MAX_MEMORY_PROJECTS = 250;

function cloneProject(project: ProjectSnapshot): ProjectSnapshot {
  return {
    ...project,
    files: { ...project.files },
    defaultProps: { ...project.defaultProps },
    inputProps: { ...project.inputProps },
  };
}

function stableSessionKey(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

export class HybridProjectStore implements ProjectStore {
  private readonly memory = new Map<string, ProjectSnapshot>();
  private readonly diskDir: string | null;

  constructor(diskDir = process.env.REMOTION_PROJECT_STORE_DIR ?? null) {
    this.diskDir = diskDir ? path.resolve(diskDir) : null;
  }

  private touchMemory(sessionId: string, project: ProjectSnapshot): void {
    if (this.memory.has(sessionId)) this.memory.delete(sessionId);
    this.memory.set(sessionId, cloneProject(project));
    while (this.memory.size > MAX_MEMORY_PROJECTS) {
      const oldest = this.memory.keys().next().value;
      if (typeof oldest !== "string") break;
      this.memory.delete(oldest);
    }
  }

  private diskPath(sessionId: string): string | null {
    if (!this.diskDir) return null;
    return path.join(this.diskDir, `${stableSessionKey(sessionId)}.json`);
  }

  async get(sessionId: string): Promise<ProjectSnapshot | null> {
    const memory = this.memory.get(sessionId);
    if (memory) {
      this.touchMemory(sessionId, memory);
      return cloneProject(memory);
    }

    const diskPath = this.diskPath(sessionId);
    if (!diskPath) return null;
    try {
      const parsed = JSON.parse(await fs.readFile(diskPath, "utf8")) as ProjectSnapshot;
      this.touchMemory(sessionId, parsed);
      return cloneProject(parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      throw error;
    }
  }

  async put(
    sessionId: string,
    project: Omit<ProjectSnapshot, "revision" | "createdAt" | "updatedAt"> &
      Partial<Pick<ProjectSnapshot, "revision" | "createdAt" | "updatedAt">>
  ): Promise<ProjectSnapshot> {
    const previous = await this.get(sessionId);
    const timestamp = now();
    const next: ProjectSnapshot = {
      ...project,
      projectId: project.projectId || previous?.projectId || randomUUID(),
      sessionId,
      revision: (previous?.revision ?? project.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? project.createdAt ?? timestamp,
      updatedAt: timestamp,
      files: { ...project.files },
      defaultProps: { ...project.defaultProps },
      inputProps: { ...project.inputProps },
    };

    this.touchMemory(sessionId, next);

    const diskPath = this.diskPath(sessionId);
    if (diskPath) {
      await fs.mkdir(path.dirname(diskPath), { recursive: true });
      const tmpPath = `${diskPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, JSON.stringify(next, null, 2), "utf8");
      await fs.rename(tmpPath, diskPath);
    }

    return cloneProject(next);
  }

  async delete(sessionId: string): Promise<void> {
    this.memory.delete(sessionId);
    const diskPath = this.diskPath(sessionId);
    if (!diskPath) return;
    try {
      await fs.unlink(diskPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export const projectStore = new HybridProjectStore();
