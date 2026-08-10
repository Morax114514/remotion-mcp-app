import { bundle, type WebpackOverrideFn } from "@remotion/bundler";
import { enableSkia } from "@remotion/skia/enable";
import { enableScss } from "@remotion/enable-scss";
import { enableTailwind } from "@remotion/tailwind-v4";
import {
  renderMedia,
  renderStill,
  selectComposition,
  type BrowserExecutable,
} from "@remotion/renderer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeFileMap, normalizeVirtualPath } from "./compiler.js";
import type { ProjectSnapshot } from "./types.js";
import { assetStore } from "./asset-store.js";

export type PreparedRenderProject = {
  workspace: string;
  serveUrl: string;
  composition: Awaited<ReturnType<typeof selectComposition>>;
  gl: GlRenderer | undefined;
  cleanup: () => Promise<void>;
};

function browserExecutable(): BrowserExecutable | undefined {
  const configured = process.env.REMOTION_BROWSER_EXECUTABLE?.trim();
  return configured ? configured as BrowserExecutable : undefined;
}

function chromeMode(): "chrome-for-testing" | "headless-shell" | undefined {
  const configured = process.env.REMOTION_CHROME_MODE?.trim();
  if (configured === "chrome-for-testing" || configured === "headless-shell") return configured;
  return undefined;
}

type GlRenderer = "angle" | "angle-egl" | "egl" | "swangle" | "swiftshader" | "vulkan";

function configuredGl(): GlRenderer | null {
  const value = process.env.REMOTION_GL?.trim() as GlRenderer | undefined;
  return value && ["angle", "angle-egl", "egl", "swangle", "swiftshader", "vulkan"].includes(value) ? value : null;
}

function hasTrue3dIntent(project: ProjectSnapshot): boolean {
  const source = Object.values(project.files).join("\n");
  return /@remotion\/three|@react-three\/fiber|three(?:\/|["'])|ThreeCanvas|WebGL|WebGPU|glsl|shader/i.test(source);
}

function usesSkia(project: ProjectSnapshot): boolean {
  const source = Object.values(project.files).join("\n");
  return /@remotion\/skia|@shopify\/react-native-skia/.test(source);
}

function isLikelyGraphicsBackendError(error: unknown): boolean {
  const message = (error as Error)?.message ?? String(error);
  // Chromium occasionally surfaces context-creation failures as an Error with
  // an empty message after logging the actual WebGL failure to the tab console.
  if (!message.trim()) return true;
  return /webgl|webgpu|gpu process|gpu context|gl context|opengl|egl|angle|vulkan|swiftshader|swangle|context lost|context creation|failed to (?:create|initialize).*context|could not (?:create|initialize).*context/i.test(message);
}

function glCandidates(project: ProjectSnapshot): Array<GlRenderer | undefined> {
  const configured = configuredGl();
  if (configured) return [configured];
  if (!hasTrue3dIntent(project) && !usesSkia(project)) return [undefined];
  // Follow Remotion's current TRUE-3D routing philosophy: try the recommended
  // ANGLE path first, then software WebGL via SwANGLE, then ANGLE-EGL.
  return ["angle", "swangle", "angle-egl"];
}

function bundlerOverrideFor(project: ProjectSnapshot): WebpackOverrideFn | undefined {
  const source = Object.entries(project.files);
  const allText = source.map(([, contents]) => contents).join("\n");
  const usesSkia = /@remotion\/skia|@shopify\/react-native-skia/.test(allText);
  const usesScss = source.some(([name]) => /\.(scss|sass)$/i.test(name)) || /@remotion\/enable-scss/.test(allText);
  const usesTailwind = /@remotion\/tailwind-v4|@import\s+["']tailwindcss/.test(allText);
  if (!usesSkia && !usesScss && !usesTailwind) return undefined;
  return (configuration) => {
    let next = configuration;
    if (usesTailwind) next = enableTailwind(next);
    if (usesScss) next = enableScss(next);
    if (usesSkia) next = enableSkia(next);
    return next;
  };
}

function workRoot(): string {
  return path.resolve(process.env.REMOTION_WORK_DIR ?? path.join(os.tmpdir(), "remotion-ultimate-work"));
}

function toDiskPath(workspace: string, virtualPath: string): string {
  const normalized = normalizeVirtualPath(virtualPath);
  const relative = normalized.slice(1);
  const resolved = path.resolve(workspace, relative);
  const root = path.resolve(workspace) + path.sep;
  if (!resolved.startsWith(root)) throw new Error(`Unsafe project path: ${virtualPath}`);
  return resolved;
}

function generatedEntrySource(project: ProjectSnapshot): string {
  const entryImport = `.${normalizeVirtualPath(project.entryFile)}`;
  const rootFactory = `const makeRoot = (Video: React.ComponentType<any>, userCalculateMetadata: unknown) => () => (
  <Composition
    id=${JSON.stringify(project.compositionId)}
    component={Video}
    durationInFrames={${project.durationInFrames}}
    fps={${project.fps}}
    width={${project.width}}
    height={${project.height}}
    defaultProps={defaultProps}
    {...(typeof userCalculateMetadata === "function" ? {calculateMetadata: userCalculateMetadata as any} : {})}
  />
);`;

  if (usesSkia(project)) {
    // Official Remotion Skia integration requires CanvasKit to be loaded before
    // the user root (and therefore Skia modules) is imported and registered.
    return `import React from "react";
import {Composition, registerRoot} from "remotion";
import {LoadSkia} from "@shopify/react-native-skia/src/web";

const defaultProps = ${JSON.stringify(project.defaultProps)};
${rootFactory}

(async () => {
  await LoadSkia();
  const UserEntry = await import(${JSON.stringify(entryImport)});
  const Video = UserEntry.default;
  if (typeof Video !== "function") {
    throw new Error("The configured entry file must default-export a React component.");
  }
  registerRoot(makeRoot(Video, UserEntry.calculateMetadata));
})();
`;
  }

  return `import React from "react";
import {Composition, registerRoot} from "remotion";
import * as UserEntry from ${JSON.stringify(entryImport)};

const Video = UserEntry.default;
const defaultProps = ${JSON.stringify(project.defaultProps)};
${rootFactory}

if (typeof Video !== "function") {
  throw new Error("The configured entry file must default-export a React component.");
}
registerRoot(makeRoot(Video, UserEntry.calculateMetadata));
`;
}

async function materializeProject(project: ProjectSnapshot): Promise<{ workspace: string; entryPoint: string }> {
  const workspace = path.join(workRoot(), `${project.projectId}-${project.revision}-${randomUUID()}`);
  await fs.mkdir(workspace, { recursive: true });

  const files = normalizeFileMap(project.files);
  for (const [virtualPath, contents] of Object.entries(files)) {
    const diskPath = toDiskPath(workspace, virtualPath);
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, contents, "utf8");
  }

  const appNodeModules = path.resolve(process.cwd(), "node_modules");
  const workspaceNodeModules = path.join(workspace, "node_modules");
  try {
    await fs.symlink(appNodeModules, workspaceNodeModules, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
  }

  const publicDir = path.join(workspace, "public");
  await fs.mkdir(publicDir, { recursive: true });
  await assetStore.materializePublic(project.projectId, publicDir);

  const entryPoint = path.join(workspace, "__ultimate_entry.tsx");
  await fs.writeFile(entryPoint, generatedEntrySource(project), "utf8");
  await fs.writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
    "utf8"
  );

  return { workspace, entryPoint };
}

async function prepareRenderProjectWithGl(
  project: ProjectSnapshot,
  gl: GlRenderer | undefined
): Promise<PreparedRenderProject> {
  const { workspace, entryPoint } = await materializeProject(project);
  const outDir = path.join(workspace, "bundle");

  try {
    const serveUrl = await bundle({
      entryPoint,
      outDir,
      rootDir: workspace,
      publicDir: path.join(workspace, "public"),
      enableCaching: true,
      ignoreRegisterRootWarning: false,
      webpackOverride: bundlerOverrideFor(project),
    });

    const composition = await selectComposition({
      serveUrl,
      id: project.compositionId,
      inputProps: project.inputProps,
      browserExecutable: browserExecutable(),
      chromeMode: chromeMode(),
      chromiumOptions: gl ? { gl } : undefined,
      logLevel: "warn",
    });

    return {
      workspace,
      serveUrl,
      composition,
      gl,
      cleanup: async () => {
        await fs.rm(workspace, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareRenderProject(project: ProjectSnapshot): Promise<PreparedRenderProject> {
  const errors: string[] = [];
  const graphicsIntent = hasTrue3dIntent(project) || usesSkia(project);
  for (const gl of glCandidates(project)) {
    try {
      return await prepareRenderProjectWithGl(project, gl);
    } catch (error) {
      errors.push(`${gl ?? "default"}: ${(error as Error).message}`);
      if (!graphicsIntent || configuredGl() || !isLikelyGraphicsBackendError(error)) throw error;
    }
  }
  throw new Error(`${hasTrue3dIntent(project) ? "All reasonable TRUE-3D render backends failed." : "All reasonable graphics render backends failed."}\n${errors.join("\n\n")}`);
}

export type RenderedStill = {
  frame: number;
  outputPath: string;
  contentType: string;
  buffer: Buffer;
  gl: GlRenderer | undefined;
};

export async function renderProjectStills(
  project: ProjectSnapshot,
  frames: number[],
  outputDir: string
): Promise<RenderedStill[]> {
  if (!frames.length) throw new Error("At least one frame is required.");
  const errors: string[] = [];
  for (const gl of glCandidates(project)) {
    let prepared: PreparedRenderProject | null = null;
    try {
      prepared = await prepareRenderProjectWithGl(project, gl);
      await fs.mkdir(outputDir, { recursive: true });
      const results: RenderedStill[] = [];
      for (const rawFrame of frames) {
        const frame = Math.max(0, Math.min(project.durationInFrames - 1, Math.floor(rawFrame)));
        const outputPath = path.join(outputDir, `${project.projectId}-r${project.revision}-f${frame}.png`);
        const result = await renderStill({
          serveUrl: prepared.serveUrl,
          composition: prepared.composition,
          inputProps: project.inputProps,
          output: outputPath,
          frame,
          imageFormat: "png",
          overwrite: true,
          browserExecutable: browserExecutable(),
          chromeMode: chromeMode(),
          chromiumOptions: gl ? { gl } : undefined,
          logLevel: "warn",
        });
        results.push({ frame, outputPath, contentType: result.contentType, buffer: await fs.readFile(outputPath), gl });
      }
      return results;
    } catch (error) {
      errors.push(`${gl ?? "default"}: ${(error as Error).message}`);
      if ((!hasTrue3dIntent(project) && !usesSkia(project)) || configuredGl() || !isLikelyGraphicsBackendError(error)) throw error;
    } finally {
      if (prepared) await prepared.cleanup();
    }
  }
  throw new Error(`${hasTrue3dIntent(project) ? "All reasonable TRUE-3D render backends failed." : "All reasonable graphics render backends failed."}\n${errors.join("\n\n")}`);
}

export type RenderedVideo = {
  outputPath: string;
  contentType: string;
  gl: GlRenderer | undefined;
};

export async function renderProjectVideo(
  project: ProjectSnapshot,
  outputDir: string,
  options?: {
    codec?: "h264" | "h265" | "vp8" | "vp9" | "prores";
    crf?: number;
    concurrency?: number | string;
  }
): Promise<RenderedVideo> {
  const errors: string[] = [];
  for (const gl of glCandidates(project)) {
    let prepared: PreparedRenderProject | null = null;
    try {
      prepared = await prepareRenderProjectWithGl(project, gl);
      await fs.mkdir(outputDir, { recursive: true });
      const codec = options?.codec ?? "h264";
      const extension = codec === "vp8" || codec === "vp9" ? "webm" : codec === "prores" ? "mov" : "mp4";
      const outputPath = path.join(outputDir, `${project.projectId}-r${project.revision}.${extension}`);
      const result = await renderMedia({
        serveUrl: prepared.serveUrl,
        composition: prepared.composition,
        inputProps: project.inputProps,
        codec,
        outputLocation: outputPath,
        overwrite: true,
        crf: options?.crf,
        concurrency: options?.concurrency,
        browserExecutable: browserExecutable(),
        chromeMode: chromeMode(),
        chromiumOptions: gl ? { gl } : undefined,
        logLevel: "warn",
      });
      return { outputPath, contentType: result.contentType, gl };
    } catch (error) {
      errors.push(`${gl ?? "default"}: ${(error as Error).message}`);
      if ((!hasTrue3dIntent(project) && !usesSkia(project)) || configuredGl() || !isLikelyGraphicsBackendError(error)) throw error;
    } finally {
      if (prepared) await prepared.cleanup();
    }
  }
  throw new Error(`${hasTrue3dIntent(project) ? "All reasonable TRUE-3D render backends failed." : "All reasonable graphics render backends failed."}\n${errors.join("\n\n")}`);
}

