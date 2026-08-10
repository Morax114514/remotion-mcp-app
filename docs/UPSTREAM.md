# Upstream snapshot

- Repository: `mcp-use/remotion-mcp-app`
- Branch: `main`
- Snapshot commit inspected: `84815888157a0403768b79a911563874d1aa014d`
- Commit date: 2026-08-05
- Upstream license: MIT

Core upstream behaviors intentionally retained:

1. `create_video` accepts a multi-file virtual Remotion project.
2. Conversation/session project state is merged across edits.
3. The ChatGPT View mounts `@remotion/player`.
4. The View exposes an in-place `update_video` tool that reuses `create_video`.
5. esbuild compiles project source for browser execution and resolves installed bare imports from the App's `node_modules`.

Ultimate changes start by extending these behaviors instead of replacing them.
