import { z } from "zod";
import { compileProjectBundle } from "./compiler.js";
import { projectStore } from "./project-store.js";
import type { ProjectSnapshot, VideoProjectData } from "./types.js";

export const DEFAULT_META = {
  title: "Untitled",
  compositionId: "Main",
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 150,
};

const ERROR_FALLBACK_BUNDLE = "var __REMOTION_MCP_BUNDLE = { default: function RemotionFallback() { return null; } };";

export type ProjectVideoInput = {
  title: string;
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  entryFile: string;
  files: Record<string, string>;
  defaultProps: Record<string, unknown>;
  inputProps: Record<string, unknown>;
};

function buildProjectData(
  overrides: Partial<VideoProjectData["meta"]> & { title?: string },
  config: {
    bundle?: string;
    defaultProps?: Record<string, unknown>;
    inputProps?: Record<string, unknown>;
    compileError?: string;
    revision?: number;
    projectId?: string;
    runtimeRequirements?: VideoProjectData["runtimeRequirements"];
  }
): VideoProjectData {
  return {
    meta: {
      title: overrides.title ?? DEFAULT_META.title,
      compositionId: overrides.compositionId ?? DEFAULT_META.compositionId,
      width: overrides.width ?? DEFAULT_META.width,
      height: overrides.height ?? DEFAULT_META.height,
      fps: overrides.fps ?? DEFAULT_META.fps,
      durationInFrames: overrides.durationInFrames ?? DEFAULT_META.durationInFrames,
    },
    bundle: config.bundle ?? ERROR_FALLBACK_BUNDLE,
    defaultProps: config.defaultProps ?? {},
    inputProps: config.inputProps ?? {},
    compileError: config.compileError,
    revision: config.revision,
    projectId: config.projectId,
    runtimeRequirements: config.runtimeRequirements,
  };
}

export function formatZodIssues(error: z.ZodError): string {
  if (!error.issues.length) return "Invalid input.";
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "input"}: ${issue.message}`)
    .join("; ");
}

function validatePositiveNumber(name: string, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return `${name} must be a positive number.`;
  return null;
}

export function failProject(
  message: string,
  fallbackMeta?: Partial<VideoProjectData["meta"]>,
  fallbackProps?: { defaultProps?: Record<string, unknown>; inputProps?: Record<string, unknown> }
) {
  const errorProject = buildProjectData(fallbackMeta ?? {}, {
    compileError: message,
    defaultProps: fallbackProps?.defaultProps,
    inputProps: fallbackProps?.inputProps,
  });
  return {
    content: [{ type: "text" as const, text: `Project error: ${message}` }],
    structuredContent: { videoProject: JSON.stringify(errorProject) },
  };
}

export async function getSessionProject(sessionId: string): Promise<ProjectSnapshot | null> {
  return projectStore.get(sessionId);
}

export async function saveSessionProject(
  sessionId: string,
  parsedInput: ProjectVideoInput,
  projectId = ""
): Promise<ProjectSnapshot> {
  return projectStore.put(sessionId, {
    projectId,
    sessionId,
    ...parsedInput,
  });
}

export async function compileAndRespondWithProject(
  parsedInput: ProjectVideoInput,
  sessionId: string,
  statusPrefixLines: string[],
  iterateToolName: "create_video" | "update_video"
) {
  const { title, compositionId, width, height, fps, durationInFrames, entryFile, files, defaultProps, inputProps } = parsedInput;
  const meta = { title, compositionId, width, height, fps, durationInFrames };

  for (const [fieldName, value] of [
    ["width", width],
    ["height", height],
    ["fps", fps],
    ["durationInFrames", durationInFrames],
  ] as const) {
    const error = validatePositiveNumber(fieldName, value);
    if (error) return failProject(error, meta, { defaultProps, inputProps });
  }

  let compiled;
  try {
    compiled = await compileProjectBundle(files, entryFile);
  } catch (error) {
    return failProject(`Project compilation error: ${(error as Error).message}`, meta, { defaultProps, inputProps });
  }

  const stored = await saveSessionProject(sessionId, {
    title,
    compositionId,
    width,
    height,
    fps,
    durationInFrames,
    entryFile: compiled.normalizedEntry,
    files: compiled.normalizedFiles,
    defaultProps,
    inputProps,
  });

  const projectData = buildProjectData(meta, {
    bundle: compiled.bundle,
    defaultProps,
    inputProps,
    revision: stored.revision,
    projectId: stored.projectId,
    runtimeRequirements: compiled.runtimeRequirements,
  });

  return {
    structuredContent: { videoProject: JSON.stringify(projectData) },
    content: [{
      type: "text" as const,
      text: [
        ...statusPrefixLines,
        `${iterateToolName === "create_video" ? "Created" : "Updated"} video project \"${title}\".`,
        `Project: ${stored.projectId}; revision: ${stored.revision}.`,
        `Entry: ${stored.entryFile} (${Object.keys(stored.files).length} files).`,
        `Composition: ${compositionId}, ${width}x${height}, ${fps}fps, ${durationInFrames} frames.`,
      ].join("\n"),
    }],
  };
}

export function sessionIdFromContext(ctx: any): string {
  const caller = ctx.client?.user?.();
  return caller?.conversationId ?? caller?.subject ?? ctx.request?.header?.("mcp-session-id") ?? "anonymous";
}
