import React from "react";
import * as ReactModule from "react";
import * as ReactJsxRuntimeModule from "react/jsx-runtime";
import * as ReactJsxDevRuntimeModule from "react/jsx-dev-runtime";
import * as RemotionModule from "remotion";
import { RUNTIME_BUNDLE_GLOBAL, RUNTIME_PACKAGE_GLOBAL } from "../types.js";

export type RuntimeMetadataInput = {
  props: Record<string, unknown>;
  defaultProps: Record<string, unknown>;
  compositionId: string;
  abortSignal?: AbortSignal;
};

export type CompiledBundle = {
  component: React.ComponentType<Record<string, unknown>>;
  calculateMetadata?: (input: RuntimeMetadataInput) => unknown | Promise<unknown>;
};

const runtimePackages: Record<string, Record<string, unknown>> = {
  react: ReactModule as Record<string, unknown>,
  "react/jsx-runtime": ReactJsxRuntimeModule as Record<string, unknown>,
  "react/jsx-dev-runtime": ReactJsxDevRuntimeModule as Record<string, unknown>,
  remotion: RemotionModule as Record<string, unknown>,
};

function ensureRuntimePackages(): void {
  const root = globalThis as Record<string, unknown>;
  const existing = root[RUNTIME_PACKAGE_GLOBAL];
  if (existing && typeof existing === "object") {
    Object.assign(existing as Record<string, unknown>, runtimePackages);
    return;
  }
  root[RUNTIME_PACKAGE_GLOBAL] = runtimePackages;
}

ensureRuntimePackages();

type RuntimeExports = { default?: unknown; calculateMetadata?: unknown };

type PreviewRuntimeRequirements = { skia?: boolean };
let skiaLoadPromise: Promise<void> | null = null;
let canvasKitScriptPromise: Promise<void> | null = null;

function setPreviewStaticBase(projectId?: string): void {
  const root = window as unknown as { remotion_staticBase?: string };
  root.remotion_staticBase = projectId ? `/project-assets/${encodeURIComponent(projectId)}` : undefined;
}

function loadCanvasKitScript(): Promise<void> {
  if (canvasKitScriptPromise) return canvasKitScriptPromise;
  canvasKitScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-remotion-ultimate-canvaskit="true"]');
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.src = "/canvaskit.js";
    script.async = true;
    script.dataset.remotionUltimateCanvaskit = "true";
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load CanvasKit runtime.")), { once: true });
    if (!existing) document.head.appendChild(script);
  });
  return canvasKitScriptPromise;
}

async function ensurePreviewRuntime(requirements?: PreviewRuntimeRequirements): Promise<void> {
  if (!requirements?.skia) return;
  if (skiaLoadPromise) return skiaLoadPromise;
  skiaLoadPromise = (async () => {
    await loadCanvasKitScript();
    const root = globalThis as unknown as {
      CanvasKit?: unknown;
      CanvasKitInit?: (opts?: { locateFile?: (file: string) => string }) => Promise<unknown>;
    };
    if (root.CanvasKit) return;
    if (typeof root.CanvasKitInit !== "function") throw new Error("CanvasKitInit was not exposed by the CanvasKit runtime.");
    root.CanvasKit = await root.CanvasKitInit({
      locateFile: () => new URL("/canvaskit.wasm", window.location.origin).toString(),
    });
  })();
  await skiaLoadPromise;
}

export async function compileBundle(
  bundleCode: string,
  runtimeRequirements?: PreviewRuntimeRequirements,
  projectId?: string
): Promise<CompiledBundle | { error: string }> {
  ensureRuntimePackages();
  setPreviewStaticBase(projectId);
  await ensurePreviewRuntime(runtimeRequirements);
  const moduleSource = `${bundleCode}\nexport default typeof ${RUNTIME_BUNDLE_GLOBAL} !== \"undefined\" ? ${RUNTIME_BUNDLE_GLOBAL} : null;`;
  const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" }));
  try {
    const imported = await import(/* @vite-ignore */ moduleUrl);
    const exports = imported.default as RuntimeExports | null;
    if (!exports || typeof exports !== "object") {
      return { error: "Compilation error: bundle did not return exports." };
    }
    if (typeof exports.default !== "function") {
      return { error: "Compilation error: entry module must default-export a React component." };
    }
    return {
      component: exports.default as React.ComponentType<Record<string, unknown>>,
      calculateMetadata:
        typeof exports.calculateMetadata === "function"
          ? exports.calculateMetadata as (input: RuntimeMetadataInput) => unknown | Promise<unknown>
          : undefined,
    };
  } catch (error) {
    return { error: `Compilation error: ${(error as Error).message}` };
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}
