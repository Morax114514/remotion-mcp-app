export const RUNTIME_BUNDLE_GLOBAL = "__REMOTION_MCP_BUNDLE";
export const RUNTIME_PACKAGE_GLOBAL = "__REMOTION_MCP_PACKAGES";

export type VideoMeta = {
  title: string;
  compositionId: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

export type VideoProjectData = {
  meta: VideoMeta;
  bundle: string;
  defaultProps: Record<string, unknown>;
  inputProps: Record<string, unknown>;
  compileError?: string;
  revision?: number;
  projectId?: string;
  runtimeRequirements?: { skia?: boolean };
};

export type ProjectSnapshot = {
  projectId: string;
  sessionId: string;
  revision: number;
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
  createdAt: string;
  updatedAt: string;
};
