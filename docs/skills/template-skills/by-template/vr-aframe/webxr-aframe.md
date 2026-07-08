# webxr-aframe

Applies to: `presetIds: vr-aframe`, `tags: xr, vr, webxr`

Use this skill when generating A-Frame or WebXR-style scenes.

## Scene Baseline

- Use a complete `<a-scene>` with camera, lighting, ground/reference plane, and visible objects.
- Make the initial scene understandable in desktop preview before VR entry.
- Use simple primitives or project assets; avoid unavailable external 3D models.

## Interaction

- In WebGL, normal DOM click assumptions do not apply. Provide cursor/raycaster interaction.
- Add `cursor` and `raycaster` configuration for gaze, mouse, or controller interaction.
- Mark only intended interactive entities as raycast targets.
- Provide visual hover/click feedback such as color change, scale, animation, or text update.

## UX

- Keep objects at comfortable distances and sizes.
- Avoid placing important content behind the camera or too close to the user.
- Provide a visible fallback interaction for non-VR desktop/mobile preview.

## Performance

- Keep geometry simple.
- Avoid excessive lights, shadows, high-poly models, or many animated entities.
- Prefer component-based reusable behavior over duplicated inline handlers.

## Avoid

- Static museum scenes with no interaction when the prompt asks for VR/gameplay.
- Click handlers without cursor/raycaster support.
- Objects outside the initial field of view.
- Large external assets without project storage.

## Acceptance Checks

- Scene is visible in normal browser preview.
- At least one object is interactable by cursor/raycaster.
- Interactive target gives visible feedback.
- Scene remains understandable without entering a headset.

Sources:

- A-Frame interactions: https://aframe.io/docs/1.8.0/introduction/interactions-and-controllers.html
- A-Frame cursor docs: https://github.com/aframevr/aframe/blob/master/docs/components/cursor.md
