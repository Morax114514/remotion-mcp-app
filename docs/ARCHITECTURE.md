# Architecture

## 1. One source, two executors

```text
Conversation / tools
        |
        v
Project Store (files + metadata + revisions)
        |------------------------------------|
        v                                    v
Preview Executor                       Render Executor
esbuild platform=browser               @remotion/bundler
@remotion/player                       @remotion/renderer
ChatGPT View                           Chrome + codec pipeline
        |                                    |
        v                                    v
interactive preview                    PNG / MP4 / WebM / MOV
```

The exact same `/src/...` files, props, composition metadata and project assets are used by both executors.

## 2. Preview Executor

The Preview Executor retains the upstream virtual multi-file project model and in-place `update_video` View tool.

React, JSX runtime and Remotion are runtime singletons supplied by the View to avoid duplicate React/Remotion contexts. Other installed browser-capable packages are bundled into the project bundle from this App's `node_modules`.

The resolver explicitly leaves package-internal relative imports to esbuild. This is required for real package graphs such as Three.js, R3F and React Native Skia.

For Skia, `.web.*` package variants are preferred and the React Native AssetRegistry native-only import is neutralized. The View loads the exact pinned CanvasKit runtime from this server before evaluating a Skia project bundle.

## 3. Render Executor

The Render Executor materializes the same virtual project into an ephemeral Remotion workspace, links the App dependency tree, generates only a root wrapper, and bundles/renders the user's unchanged entry source.

Conditional webpack integrations:

- Skia -> `enableSkia()` and CanvasKit preloading before user entry import;
- SCSS/Sass -> `enableScss()`;
- Tailwind v4 -> `enableTailwind()`.

For Three/R3F and other graphics-context-dependent work, backend failure causes runtime backend fallback rather than visual-source degradation. The backend that succeeds is returned in render tool output.

## 4. Project Store

`HybridProjectStore` provides:

- in-memory LRU access;
- stable project UUID;
- monotonic revisions;
- optional atomic filesystem persistence through `REMOTION_PROJECT_STORE_DIR`.

The storage interface can later be replaced with database/object-storage adapters without changing MCP tool semantics.

## 5. Asset Store

Binary assets are not embedded into the TSX source tree.

`upload_asset` stores bytes under a project ID with SHA-256 metadata. Composition source uses standard Remotion `staticFile(path)`.

Preview:

```text
staticFile("assets/hero.mp4")
 -> window.remotion_staticBase
 -> /project-assets/<projectId>/assets/hero.mp4
```

Render:

```text
same staticFile("assets/hero.mp4")
 -> asset materialized into workspace/public/assets/hero.mp4
 -> normal Remotion publicDir resolution
```

This keeps source parity between preview and final render.

## 6. Output Store

Rendered files are registered and served from `/renders/:id/:filename`. `REMOTION_PUBLIC_BASE_URL` can be used to return externally reachable URLs.

The current filesystem adapters are suitable for a single persistent server. A horizontally scaled deployment should replace project/assets/outputs with durable shared storage.
