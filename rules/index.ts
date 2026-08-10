export const RULE_INDEX = `# Remotion Ultimate MCP App

Call this first for every real Remotion creation/editing task.

Core invariant: ONE project source, TWO executors.
- Preview Executor: browser esbuild bundle -> ChatGPT Remotion Player.
- Render Executor: @remotion/bundler + @remotion/renderer -> real stills / media.
Never maintain a separate preview implementation and render implementation.

Recommended workflow:
1. Read the task-relevant rules.
2. Create or inspect the actual multi-file project.
3. Use create_video for the first mounted Player.
4. Iterate with the mounted View's update_video whenever possible.
5. Use project read/write/replace/delete tools for exact source operations.
6. Put binary media/models/fonts in the Asset Store and reference them with staticFile().
7. validate_project with executor="both" before final output.
8. Render representative stills and visually review them.
9. Fix the actual project, not a mock or separate preview copy.
10. Render final media only after the visual quality gate passes.

Rules:
- rule_react_code
- rule_remotion_animations
- rule_remotion_timing
- rule_remotion_sequencing
- rule_remotion_transitions
- rule_remotion_text_animations
- rule_remotion_trimming
- rule_director_quality
- rule_graphics_runtime
- rule_media_assets
- rule_ultimate_capabilities

Main project tools:
- create_video / in-View update_video
- list_project_files / read_project_file
- write_project_file / replace_project_file / delete_project_file
- upload_asset / list_assets / delete_asset
- validate_project / list_compositions
- render_still / render_stills / render_video`;

export const RULE_REACT_CODE = `# React / project code
- Entry defaults to /src/Video.tsx and must default-export a React component.
- Prefer real multi-file structure: /src/scenes, /src/components, /src/lib and styles.
- Keep visual state deterministic and frame-driven.
- Composition source must stay browser-safe. Renderer/bundler APIs run through MCP render tools, not inside the Player iframe.
- React and Remotion are runtime singletons; never vendor or bundle a second React runtime manually.`;

export const RULE_REMOTION_ANIMATIONS = `# Animation
Use useCurrentFrame(), useVideoConfig(), interpolate(), spring(), Easing and deterministic math. Avoid CSS keyframes, requestAnimationFrame(), setTimeout(), Date.now(), and uncontrolled randomness for final frame state.`;

export const RULE_REMOTION_TIMING = `# Timing
Frame is the source of truth. Convert seconds to frames from fps. Use explicit ranges, clamps and scene-local timing. Motion curves must communicate intent rather than merely add activity.`;

export const RULE_REMOTION_SEQUENCING = `# Sequencing
Use Sequence, Series, TransitionSeries and local-frame reasoning. Each shot should have one primary narrative/visual task. Split overloaded scenes rather than stacking unrelated text, HUD, particles and effects.`;

export const RULE_REMOTION_TRANSITIONS = `# Transitions
Import TransitionSeries from @remotion/transitions. Transitions must connect states: motivated wipes, pushes, fades, masks, camera continuity or custom effects. Avoid decorative transition spam.`;

export const RULE_REMOTION_TEXT_ANIMATIONS = `# Text
Prioritize hierarchy, line length, contrast, spacing and readable dwell time. Animate with frame-driven transforms, masks, opacity, tracking or scale. Typography should never become unreadable just to demonstrate motion.`;

export const RULE_REMOTION_TRIMMING = `# Trimming
Use deterministic Sequence offsets, durations and media trim controls. Preview and final render must resolve the same timeline.`;

export const RULE_DIRECTOR_QUALITY = `# Director / quality gate
Design before implementation: define the audience takeaway, one dominant visual premise, narrative arc, shot purpose, camera/framing, light/material/color, motion language, transition logic and audio cues.

Quality priority:
narrative/information purpose > focal hierarchy/composition > shot rhythm/motion > lighting/material/color/type > implementation stability > effect complexity.

Do not equate "premium" with black background, glow, particles, HUD, glitch or constant camera orbit. Every motion should guide attention, reveal information, establish space, express causality, strengthen rhythm, connect shots or support emotion.

Before final media, render representative stills covering opening, visual-language establishment, major transformation/explanation, hardest shot, hero/peak moment and ending. Reject frames with unclear focus, overloaded information, inconsistent visual language, fake-looking material/light, or a web-demo collage feel.`;

export const RULE_GRAPHICS_RUNTIME = `# Graphics runtime
TRUE 3D means actual spatial geometry/camera/light/material/shadow logic. If a GL backend fails, diagnose or try another real backend; do not silently replace Three/R3F with CSS pseudo-3D.

Capability levels are distinct: dependency installed != import success != bundle success != browser launch != GL/WebGPU context != actual output. Claim graphics capability only after actual output in the target environment.

Skia requires CanvasKit and the Skia bundler integration. WebGPU is only proven after a real adapter/device/context and successful output. If WebGPU fails but WebGL can preserve the intended visual, prefer real WebGL/Three over a 2D downgrade.`;

export const RULE_MEDIA_ASSETS = `# Media / assets
Keep large binary assets out of create_video source JSON. Store them with upload_asset and reference them with normal Remotion staticFile(path). The same staticFile() call resolves through the Project Asset Store in Preview and through materialized publicDir in Render.

Use media, captions, BGM, SFX and voice as part of the shot design rather than an afterthought. Validate actual media duration/codecs when final delivery matters.`;

export const RULE_ULTIMATE_CAPABILITIES = `# Ultimate capabilities
Baseline: Remotion 4.0.507 Ultimate Portable dependency set plus the upstream MCP App runtime.

Browser-capable composition code may use installed packages such as Three.js/R3F/Drei, @remotion/three, Effects, Shapes, Paths, Noise, Motion Blur, Skia, Lottie, Rive, media, captions, charts, maps and physics libraries.

Server-only packages such as @remotion/renderer and @remotion/bundler are intentionally outside the Player iframe and exposed through the Render Executor. That is execution separation, not capability removal.`;
