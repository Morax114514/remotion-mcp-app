# Verification status

Verification basis: the uploaded Remotion Ultimate Portable 4.0.507 archive was reassembled and its SHA-256 matched the supplied checksum before extraction.

## Verified in the current Linux execution environment

- Portable Node runtime: works.
- Remotion package baseline: 4.0.507 exact package family.
- Preview compiler, basic React/Remotion project: bundles.
- Preview compiler, real `@remotion/three` / R3F project: bundles.
- Preview compiler, Skia project: bundles after web-resolution compatibility handling.
- Preview Player harness: mounts compiled project bundle in `@remotion/player`.
- Shared `staticFile()` asset source: visibly works in browser Player harness and real Render Executor output.
- Render Executor basic PNG stills: real output produced.
- Render Executor H.264 media: real MP4 produced and ffprobe-validated (640x360, 30fps, H.264; AAC audio stream; ~2.048s smoke composition).
- TRUE 3D Three/R3F still: real shaded cube produced after graphics fallback; successful backend was `angle-egl` in this sandbox.
- Skia still: real Skia output produced after graphics fallback; successful backend was `angle-egl` in this sandbox.

## Not yet claimed as verified

- A complete `mcp-use build` of this fork in the final hosting environment.
- ChatGPT-hosted iframe behavior after deployment.
- Every package in the Ultimate dependency baseline under every cloud runtime/GPU combination.
- WebGPU context/device availability. Import/bundle success is not counted as WebGPU render proof.

Those are deployment/runtime checks and must be tested in the environment where the App will actually run.
