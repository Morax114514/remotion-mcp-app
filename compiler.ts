import { build, type Loader, type Plugin } from "esbuild";
import path from "node:path";
import * as ReactModule from "react";
import * as ReactJsxRuntimeModule from "react/jsx-runtime";
import * as ReactJsxDevRuntimeModule from "react/jsx-dev-runtime";
import * as RemotionModule from "remotion";
import { isServerOnlyPreviewImport } from "./capabilities.js";
import { RUNTIME_BUNDLE_GLOBAL, RUNTIME_PACKAGE_GLOBAL } from "./types.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const USER_FILE_NAMESPACE = "user-file";
const SHIM_FILE_NAMESPACE = "runtime-shim";
const EMPTY_MODULE_NAMESPACE = "empty-module";

const SUPPORTED_SOURCE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
] as const;

const RUNTIME_MODULES: Record<string, Record<string, unknown>> = {
  react: ReactModule as Record<string, unknown>,
  "react/jsx-runtime": ReactJsxRuntimeModule as Record<string, unknown>,
  "react/jsx-dev-runtime": ReactJsxDevRuntimeModule as Record<string, unknown>,
  remotion: RemotionModule as Record<string, unknown>,
};

function createRuntimeShim(moduleName: string, moduleNamespace: Record<string, unknown>): string {
  const namedExports = Object.keys(moduleNamespace)
    .filter((name) => name !== "default" && IDENTIFIER_PATTERN.test(name))
    .sort();

  const exportLines = namedExports
    .map((name) => `export const ${name} = runtime.${name};`)
    .join("\n");

  return [
    `const modules = globalThis.${RUNTIME_PACKAGE_GLOBAL};`,
    `const runtime = modules?.[${JSON.stringify(moduleName)}];`,
    `if (!runtime) throw new Error(${JSON.stringify(`Missing runtime module: ${moduleName}`)});`,
    "export default runtime.default;",
    exportLines,
    "",
  ].join("\n");
}

const SHIM_MODULE_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(RUNTIME_MODULES).map(([moduleName, moduleNamespace]) => [
    moduleName,
    createRuntimeShim(moduleName, moduleNamespace),
  ])
);

export function normalizeVirtualPath(filePath: string): string {
  const unixPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(`/${unixPath}`);
  if (!normalized.startsWith("/") || normalized.includes("/../")) {
    throw new Error(`Invalid file path: ${filePath}`);
  }
  return normalized;
}

export function normalizeFileMap(files: Record<string, string>): Record<string, string> {
  const normalizedFiles: Record<string, string> = {};
  for (const [rawFilePath, contents] of Object.entries(files)) {
    if (typeof contents !== "string") {
      throw new Error(`File \"${rawFilePath}\" must be a string.`);
    }
    normalizedFiles[normalizeVirtualPath(rawFilePath)] = contents;
  }
  return normalizedFiles;
}

function getLoader(filePath: string): Loader {
  const extension = path.posix.extname(filePath).toLowerCase();
  switch (extension) {
    case ".tsx": return "tsx";
    case ".ts": return "ts";
    case ".jsx": return "jsx";
    case ".mjs":
    case ".cjs":
    case ".js": return "js";
    case ".json": return "json";
    case ".css": return "css";
    case ".svg":
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".mp4":
    case ".webm":
    case ".mov":
    case ".mp3":
    case ".wav":
    case ".ogg": return "dataurl";
    default: return "tsx";
  }
}

function resolveVirtualImport(
  importPath: string,
  importer: string,
  files: Record<string, string>
): string | null {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;

  const basePath = importPath.startsWith("/")
    ? normalizeVirtualPath(importPath)
    : normalizeVirtualPath(path.posix.resolve(path.posix.dirname(importer), importPath));

  const candidates = new Set<string>();
  const extension = path.posix.extname(basePath);
  if (extension.length > 0) {
    candidates.add(basePath);
  } else {
    candidates.add(basePath);
    for (const candidateExtension of SUPPORTED_SOURCE_EXTENSIONS) {
      candidates.add(`${basePath}${candidateExtension}`);
      candidates.add(path.posix.join(basePath, `index${candidateExtension}`));
    }
  }

  for (const candidate of candidates) {
    if (candidate in files) return candidate;
  }
  return null;
}

function formatCompileFailure(error: unknown): string {
  const fallback = (error as Error)?.message ?? "Unknown build error.";
  const maybe = error as {
    errors?: Array<{
      text: string;
      location?: { file?: string; line?: number; column?: number; lineText?: string } | null;
    }>;
  };
  if (!Array.isArray(maybe.errors) || maybe.errors.length === 0) return fallback;
  return maybe.errors.slice(0, 8).map((err) => {
    const location = err.location;
    if (!location) return err.text;
    const column = typeof location.column === "number" ? location.column + 1 : undefined;
    const at = [location.file, location.line, column].filter(Boolean).join(":");
    const context = location.lineText ? `\n> ${location.lineText.trim()}` : "";
    return `${at} ${err.text}${context}`;
  }).join("\n");
}

function addCompileHints(message: string): string {
  const hints: string[] = [];
  if (message.includes("No matching export") && message.includes("TransitionSeries")) {
    hints.push("Hint: import TransitionSeries from @remotion/transitions, not from remotion.");
  }
  if (message.includes("No matching export") && message.includes("fade")) {
    hints.push("Hint: import fade from @remotion/transitions/fade.");
  }
  if (message.toLowerCase().includes("unterminated string literal")) {
    hints.push("Hint: check for missing quote characters in JSX style/object literals.");
  }
  if (!hints.length) return message;
  return `${message}\n\n${hints.join("\n")}`;
}

export type PreviewRuntimeRequirements = {
  skia: boolean;
};

export function detectPreviewRuntimeRequirements(files: Record<string, string>): PreviewRuntimeRequirements {
  const source = Object.values(files).join("\n");
  return {
    skia: /@remotion\/skia|@shopify\/react-native-skia/.test(source),
  };
}

export type CompileProjectResult = {
  bundle: string;
  normalizedFiles: Record<string, string>;
  normalizedEntry: string;
  runtimeRequirements: PreviewRuntimeRequirements;
};

export async function compileProjectBundle(
  files: Record<string, string>,
  entryFile: string
): Promise<CompileProjectResult> {
  const normalizedFiles = normalizeFileMap(files);
  const normalizedEntry = normalizeVirtualPath(entryFile);

  if (!(normalizedEntry in normalizedFiles)) {
    const availableFiles = Object.keys(normalizedFiles).sort().join(", ");
    throw new Error(
      `Entry file \"${normalizedEntry}\" does not exist. Available files: ${availableFiles || "none"}.`
    );
  }

  const virtualProjectPlugin: Plugin = {
    name: "ultimate-virtual-project",
    setup(buildContext) {
      buildContext.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === "react-native/Libraries/Image/AssetRegistry") {
          return { path: args.path, namespace: EMPTY_MODULE_NAMESPACE };
        }

        if (args.path in SHIM_MODULE_SOURCES) {
          return { path: args.path, namespace: SHIM_FILE_NAMESPACE };
        }

        // Resolve virtual project imports ourselves, but never intercept relative
        // imports inside real node_modules packages. Three.js, R3F, Skia and
        // many other production packages have their own relative module graph
        // which must remain under esbuild's normal file resolver.
        const isVirtualAbsolute = args.path.startsWith("/");
        const isUserRelative = args.path.startsWith(".") && args.namespace === USER_FILE_NAMESPACE;
        if (isVirtualAbsolute || isUserRelative) {
          const importer = args.importer && args.importer !== "<stdin>"
            ? args.importer
            : normalizedEntry;
          const resolvedFilePath = resolveVirtualImport(args.path, importer, normalizedFiles);
          if (resolvedFilePath) {
            return { path: resolvedFilePath, namespace: USER_FILE_NAMESPACE };
          }
          return { errors: [{ text: `Cannot resolve import \"${args.path}\" from \"${importer}\".` }] };
        }

        if (args.path.startsWith(".")) {
          return;
        }

        if (isServerOnlyPreviewImport(args.path)) {
          return {
            errors: [{
              text:
                `Package \"${args.path}\" belongs to the Render Executor and cannot execute inside the ChatGPT Player iframe. ` +
                "Use it through render_still/render_stills/render_video; keep the composition source browser-safe so the same source can be previewed and rendered.",
            }],
          };
        }

        // Preserve upstream behavior: installed browser-capable bare imports are
        // resolved from this App's node_modules and bundled into the preview.
        return;
      });

      buildContext.onLoad({ filter: /.*/, namespace: SHIM_FILE_NAMESPACE }, (args) => ({
        contents: SHIM_MODULE_SOURCES[args.path],
        loader: "js",
        resolveDir: "/",
      }));

      buildContext.onLoad({ filter: /.*/, namespace: EMPTY_MODULE_NAMESPACE }, () => ({
        contents: "export default {};",
        loader: "js",
      }));

      buildContext.onLoad({ filter: /.*/, namespace: USER_FILE_NAMESPACE }, (args) => {
        const contents = normalizedFiles[args.path];
        if (typeof contents !== "string") {
          return { errors: [{ text: `Could not load file \"${args.path}\".` }] };
        }
        return {
          contents,
          loader: getLoader(args.path),
          resolveDir: process.cwd(),
        };
      });
    },
  };

  try {
    const result = await build({
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      target: ["es2020"],
      resolveExtensions: [".web.tsx", ".web.ts", ".web.jsx", ".web.js", ".tsx", ".ts", ".jsx", ".js", ".css", ".json"],
      globalName: RUNTIME_BUNDLE_GLOBAL,
      jsx: "automatic",
      logLevel: "silent",
      stdin: {
        loader: "ts",
        resolveDir: process.cwd(),
        contents: [
          `import * as entryModule from ${JSON.stringify(normalizedEntry)};`,
          "export default entryModule.default;",
          `export * from ${JSON.stringify(normalizedEntry)};`,
        ].join("\n"),
      },
      plugins: [virtualProjectPlugin],
    });
    const output = result.outputFiles[0]?.text;
    if (!output) throw new Error("Compilation produced no JavaScript output.");
    return { bundle: output, normalizedFiles, normalizedEntry, runtimeRequirements: detectPreviewRuntimeRequirements(normalizedFiles) };
  } catch (error) {
    throw new Error(addCompileHints(formatCompileFailure(error)));
  }
}
