# creative-canvas-p5

Applies to: `tags: generative, creative-coding, canvas`

Use this skill when generating creative-coding artifacts, generative visuals, particle systems,
interactive sketches, or abstract canvas experiences with p5.js.

## Sketch Structure

- Use `setup` for canvas creation, state initialization, and deterministic seeds.
- Use `draw` for animation and rendering.
- Keep simulation state explicit in arrays/objects rather than hidden in many globals.
- Consider p5 instance mode when multiple sketches or other libraries may share the page.

## Responsiveness

- Resize the canvas when the browser or iframe changes size.
- Recompute layout anchors after resize.
- Avoid assuming a fixed desktop viewport.

## Interaction

- Provide at least one meaningful interaction: pointer attraction, click to reset, drag, keyboard toggle, parameter slider, or mode switch.
- Show visual feedback when the user interacts.
- Keep interaction discoverable through visible controls or obvious affordances.

## Generative Quality

- Use seeded randomness when repeatability matters.
- Build systems from simple rules: particles, flow fields, agents, waves, grids, or cellular patterns.
- Limit element counts to keep animation smooth in an iframe.

## Avoid

- A static canvas with no interaction when the prompt asks for an interactive artifact.
- Heavy per-frame DOM writes.
- Unbounded particle creation.
- Hardcoded canvas dimensions with no resize path.

## Acceptance Checks

- Canvas fills the intended area on desktop and mobile.
- Interaction visibly changes the sketch.
- Animation remains smooth for at least 30 seconds.
- Resize does not leave blank or clipped regions.

Sources:

- p5 `windowResized`: https://p5js.org/reference/p5/windowResized/
- p5 `resizeCanvas`: https://p5js.org/reference/p5/resizeCanvas/
