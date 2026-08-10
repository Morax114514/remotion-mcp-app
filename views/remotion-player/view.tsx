import React, { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  McpUseProvider,
  useCallTool,
  useDisplayMode,
  useSendFollowUp,
  useToolContext,
  useViewTheme,
  useViewTool,
} from "mcp-use/react";
import { Player } from "@remotion/player";
import { z } from "zod";
import { compileBundle, type CompiledBundle } from "./components/CodeComposition.js";
import type { VideoMeta, VideoProjectData } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function positiveNumberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function toPropsObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseVideoProject(input: Record<string, unknown> | null): VideoProjectData | null {
  if (!input || typeof input.videoProject !== "string") return null;
  try {
    const parsed = JSON.parse(input.videoProject) as Record<string, unknown>;
    if (!isRecord(parsed) || !isRecord(parsed.meta) || typeof parsed.bundle !== "string") return null;
    const meta = parsed.meta;
    return {
      meta: {
        title: typeof meta.title === "string" ? meta.title : "Untitled",
        compositionId: typeof meta.compositionId === "string" ? meta.compositionId : "Main",
        width: positiveNumberOrFallback(meta.width, 1920),
        height: positiveNumberOrFallback(meta.height, 1080),
        fps: positiveNumberOrFallback(meta.fps, 30),
        durationInFrames: positiveNumberOrFallback(meta.durationInFrames, 150),
      },
      bundle: parsed.bundle,
      defaultProps: toPropsObject(parsed.defaultProps),
      inputProps: toPropsObject(parsed.inputProps),
      compileError: typeof parsed.compileError === "string" ? parsed.compileError : undefined,
      revision: typeof parsed.revision === "number" ? parsed.revision : undefined,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
      runtimeRequirements: isRecord(parsed.runtimeRequirements)
        ? { skia: parsed.runtimeRequirements.skia === true }
        : undefined,
    };
  } catch {
    return null;
  }
}

function readMetadataOverrides(overrides: Record<string, unknown>, fallback: VideoMeta): VideoMeta {
  return {
    ...fallback,
    width: positiveNumberOrFallback(overrides.width, fallback.width),
    height: positiveNumberOrFallback(overrides.height, fallback.height),
    fps: positiveNumberOrFallback(overrides.fps, fallback.fps),
    durationInFrames: positiveNumberOrFallback(overrides.durationInFrames, fallback.durationInFrames),
  };
}

class ErrorBoundary extends Component<
  { children: ReactNode; onError?: (message: string) => void },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error.message);
    console.error("[remotion-ultimate] player error", error, info.componentStack);
  }
  render() {
    if (this.state.error) return <ErrorPanel message={this.state.error} />;
    return this.props.children;
  }
}

function ErrorPanel({ message, onFix }: { message: string; onFix?: () => void }) {
  return (
    <div style={{ padding: 16, borderRadius: 12, background: "#1c1c1c", color: "#ff8c8c", fontFamily: "system-ui" }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Remotion preview error</div>
      <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.92 }}>{message}</pre>
      {onFix ? (
        <button onClick={onFix} style={{ marginTop: 12, border: 0, borderRadius: 8, padding: "8px 12px", cursor: "pointer" }}>
          Ask ChatGPT to fix
        </button>
      ) : null}
    </div>
  );
}

const updateVideoSchema = z.object({
  files: z.string().describe('JSON string containing changed files, e.g. {"/src/Video.tsx":"..."}'),
  deleteFiles: z.array(z.string()).optional(),
  entryFile: z.string().optional(),
  title: z.string().optional(),
  compositionId: z.string().optional(),
  durationInFrames: z.number().positive().optional(),
  fps: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  defaultProps: z.record(z.string(), z.unknown()).optional(),
  inputProps: z.record(z.string(), z.unknown()).optional(),
});

const updateVideoOutputSchema = z.object({
  videoProject: z.string(),
});

function RemotionPlayerWidgetInner() {
  const view = useToolContext<"create_video">();
  const createVideo = useCallTool("create_video");
  const sendFollowUp = useSendFollowUp();
  const theme = useViewTheme();
  const { displayMode, availableDisplayModes, requestDisplayMode } = useDisplayMode();
  const dark = theme === "dark";
  const [viewOverride, setViewOverride] = useState<VideoProjectData | null>(null);
  const previousData = useRef<VideoProjectData | null>(null);
  const [compiled, setCompiled] = useState<CompiledBundle | { error: string } | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);

  const rawVideoProject = view.status === "ready" ? view.toolOutput.videoProject : null;
  const serverData = useMemo(
    () => typeof rawVideoProject === "string" ? parseVideoProject({ videoProject: rawVideoProject }) : null,
    [rawVideoProject]
  );

  useEffect(() => setViewOverride(null), [rawVideoProject]);
  const currentData = viewOverride ?? serverData;
  const isBusy = view.status === "pending" || createVideo.isPending || isCompiling;
  const data = currentData ?? (isBusy ? previousData.current : null);
  useEffect(() => { if (currentData) previousData.current = currentData; }, [currentData]);

  useEffect(() => {
    const onFullscreenChange = () => setNativeFullscreen(document.fullscreenElement === playerContainerRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useViewTool(
    {
      name: "update_video",
      title: "Update video in place",
      description: "Patch the current Remotion project and replace this mounted Player without creating a new View.",
      inputSchema: updateVideoSchema,
      outputSchema: updateVideoOutputSchema,
      enabled: !!data && !createVideo.isPending,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = await createVideo.callTool(args);
        const raw = result.structuredContent?.videoProject;
        if (typeof raw !== "string") throw new Error("Update returned no videoProject.");
        const next = parseVideoProject({ videoProject: raw });
        if (!next) throw new Error("Updated videoProject could not be parsed.");
        previousData.current = next;
        setViewOverride(next);
        setPlayerError(null);
        return result;
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Could not update video: ${(error as Error).message}` }] };
      }
    }
  );

  useEffect(() => {
    let active = true;
    if (!data || data.compileError) {
      setCompiled(null);
      setIsCompiling(false);
      return () => { active = false; };
    }
    setIsCompiling(true);
    void compileBundle(data.bundle, data.runtimeRequirements, data.projectId).then((result) => {
      if (!active) return;
      setCompiled(result);
      setIsCompiling(false);
    });
    return () => { active = false; };
  }, [data?.bundle, data?.compileError, data?.runtimeRequirements?.skia]);

  const mergedProps = useMemo(() => data ? { ...data.defaultProps, ...data.inputProps } : {}, [data]);
  const [resolvedMeta, setResolvedMeta] = useState<VideoMeta | null>(null);
  useEffect(() => { setResolvedMeta(data?.meta ?? null); }, [data?.meta, data?.bundle]);

  useEffect(() => {
    if (!data || !compiled || "error" in compiled || !compiled.calculateMetadata) return;
    const controller = new AbortController();
    Promise.resolve(compiled.calculateMetadata({
      props: mergedProps,
      defaultProps: data.defaultProps,
      compositionId: data.meta.compositionId,
      abortSignal: controller.signal,
    })).then((metadata) => {
      if (!controller.signal.aborted && isRecord(metadata)) {
        setResolvedMeta((current) => readMetadataOverrides(metadata, current ?? data.meta));
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setPlayerError(`calculateMetadata: ${(error as Error).message}`);
    });
    return () => controller.abort();
  }, [compiled, data, mergedProps]);

  const compileError = data?.compileError ?? (compiled && "error" in compiled ? compiled.error : null) ?? playerError;
  const compiledProject = compiled && !("error" in compiled) ? compiled : null;
  const meta = resolvedMeta ?? data?.meta ?? null;

  const canAppFullscreen = availableDisplayModes.includes("fullscreen");
  const appFullscreen = canAppFullscreen && displayMode === "fullscreen";
  const fullscreen = appFullscreen || nativeFullscreen;
  const canNativeFullscreen = typeof document !== "undefined" && typeof document.documentElement?.requestFullscreen === "function";
  const toggleFullscreen = useCallback(() => {
    if (canAppFullscreen) {
      requestDisplayMode(appFullscreen ? "inline" : "fullscreen");
      return;
    }
    if (!canNativeFullscreen) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void playerContainerRef.current?.requestFullscreen();
    }
  }, [appFullscreen, canAppFullscreen, canNativeFullscreen, requestDisplayMode]);

  const askFix = useCallback(() => {
    if (!compileError) return;
    sendFollowUp({ prompt: `Fix the current Remotion project preview error without changing the intended visual design:\n\n${compileError}` });
  }, [compileError, sendFollowUp]);

  if (!data && isBusy) {
    return <div style={{ height: 240, display: "grid", placeItems: "center", borderRadius: 12, background: dark ? "#111" : "#f4f4f4" }}>Compiling Remotion preview…</div>;
  }
  if (!data) {
    return <div style={{ padding: 24, borderRadius: 12, background: dark ? "#111" : "#f4f4f4" }}>No video project data.</div>;
  }
  if (compileError) return <ErrorPanel message={compileError} onFix={askFix} />;
  if (!compiledProject || !meta) return <div style={{ height: 240, display: "grid", placeItems: "center" }}>Compiling…</div>;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta.title}</div>
          <div style={{ fontSize: 11, opacity: 0.55 }}>
            {data.projectId ? `${data.projectId.slice(0, 8)} · ` : ""}rev {data.revision ?? "?"} · {meta.width}×{meta.height} · {meta.fps}fps · {meta.durationInFrames}f
          </div>
        </div>
        {canAppFullscreen || canNativeFullscreen ? <button onClick={toggleFullscreen}>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</button> : null}
      </div>
      <ErrorBoundary onError={setPlayerError}>
        <div ref={playerContainerRef} style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000" }}>
          <Player
            component={compiledProject.component as any}
            inputProps={mergedProps}
            durationInFrames={meta.durationInFrames}
            fps={meta.fps}
            compositionWidth={meta.width}
            compositionHeight={meta.height}
            controls
            autoPlay
            loop
            style={{ width: "100%", maxWidth: "100%", margin: 0 }}
          />
          {isBusy ? (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,.45)", backdropFilter: "blur(8px)", color: "white", pointerEvents: "none" }}>
              Updating preview…
            </div>
          ) : null}
        </div>
      </ErrorBoundary>
    </div>
  );
}

export default function RemotionPlayerWidget() {
  return (
    <McpUseProvider autoSize>
      <RemotionPlayerWidgetInner />
    </McpUseProvider>
  );
}
