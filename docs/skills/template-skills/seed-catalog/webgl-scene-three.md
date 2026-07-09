# webgl-scene-three

Applies to: `presetIds: game3d`, `tags: 3d, webgl`

Use this skill when generating a Three.js scene, 3D interactive artifact, 3D portfolio, or WebGL
visualization.

## Scene Baseline

- Create a scene, camera, renderer, lights, and at least one visible mesh.
- Append the renderer canvas to a dedicated full-bleed or clearly sized container.
- Set renderer pixel ratio conservatively to avoid slow mobile performance.
- Use an animation loop that renders every frame.

## Camera And Layout

- Place the camera so the primary subject is visible immediately.
- Recompute camera aspect and renderer size on resize.
- Avoid burying the 3D scene inside a tiny decorative preview card when the artifact is primarily 3D.

## Interaction

- Add pointer or keyboard interaction when the prompt implies exploration.
- Use raycasting for object picking when clicking 3D objects.
- Provide visible instructions only when interaction is not self-evident.

## Performance

- Prefer procedural primitives and simple materials for generated artifacts.
- Avoid large external GLTF/texture dependencies unless explicitly available through project assets.
- Cap object counts and avoid creating new geometry every frame.
- Dispose old materials/geometries if rebuilding a scene.

## Avoid

- Blank canvas because camera, lights, or object positions are wrong.
- A render loop that updates state but never calls `renderer.render`.
- Non-responsive canvas size.
- External model URLs that may fail in export/publish.

## Acceptance Checks

- First frame is nonblank.
- Scene animates or responds to input.
- Resize keeps the subject visible.
- No runtime dependency on unavailable external assets.

Sources:

- Three.js docs: https://threejs.org/docs/
- Three.js manual: https://threejs.org/manual/
- Three.js Raycaster docs: https://threejs.org/docs/pages/Raycaster.html
