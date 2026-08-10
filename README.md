# Remotion Ultimate MCP App

A shared-source Remotion 4.0.507 MCP App that combines:

- the upstream `mcp-use/remotion-mcp-app` conversation workflow and in-place ChatGPT Player preview;
- the full creative/runtime dependency baseline verified from Remotion Ultimate Portable 4.0.507;
- a real `@remotion/bundler` + `@remotion/renderer` final render executor;
- persistent project revisions and binary asset storage.

## Core invariant

There is one project source of truth and two executors:

```text
ChatGPT
  -> Project Store
       -> Preview Executor -> esbuild -> @remotion/player in the conversation
       -> Render Executor  -> @remotion/bundler -> @remotion/renderer -> PNG / media
```

Preview and render never maintain separate source trees.

## Main tools

Creation and iteration:

- `read_me`
- `get_capabilities`
- `create_video`
- View-only `update_video` for in-place Player updates

Project source:

- `list_project_files`
- `read_project_file`
- `write_project_file`
- `replace_project_file`
- `delete_project_file`
- `validate_project`
- `list_compositions`

Assets:

- `upload_asset`
- `list_assets`
- `delete_asset`

Use normal Remotion `staticFile("assets/name.ext")` in source. The Preview Executor routes it to the project Asset Store; the Render Executor materializes the same asset into the Remotion public directory. The source code is unchanged between executors.

Rendering:

- `render_still`
- `render_stills`
- `render_video`

## Graphics

The app includes the Portable creative stack, including Three.js / React Three Fiber / Drei, `@remotion/three`, Skia, Effects, Shapes, Paths, Noise, Motion Blur, media/captions, charts, maps and physics libraries.

For real rendering, graphics backend selection is runtime-tested. TRUE 3D is never silently replaced with CSS pseudo-3D. If no GL backend can actually produce the requested result, the render fails with diagnostics instead of changing the visual dimension.

Skia uses `enableSkia()` in the Render Executor and loads CanvasKit before registering the user entry. The Preview Executor serves its pinned CanvasKit JS/WASM runtime before evaluating a Skia project bundle.

## Environment

Optional persistence / output configuration:

```text
REMOTION_PROJECT_STORE_DIR=/persistent/projects
REMOTION_ASSET_STORE_DIR=/persistent/assets
REMOTION_OUTPUT_DIR=/persistent/outputs
REMOTION_PUBLIC_BASE_URL=https://your-app.example
```

Rendering configuration:

```text
REMOTION_BROWSER_EXECUTABLE=/path/to/chrome
REMOTION_CHROME_MODE=chrome-for-testing
REMOTION_GL=angle-egl
REMOTION_WORK_DIR=/tmp/remotion-work
REMOTION_MAX_ASSET_BYTES=268435456
```

If `REMOTION_GL` is not fixed and the project needs Three/R3F or Skia, the Render Executor can try its configured graphics fallback sequence and reports the backend that actually succeeded.

## Development

```bash
npm install
npm run check:syntax
npm run dev
```

For a production ChatGPT test, deploy the MCP App and add its MCP endpoint to ChatGPT, then call `read_me` followed by `create_video`.

## Provenance

The app extends the MIT-licensed `mcp-use/remotion-mcp-app` architecture. See `docs/UPSTREAM.md`.

The Remotion dependency stack has its own licensing terms; review Remotion licensing before operating this as a hosted automation service.
