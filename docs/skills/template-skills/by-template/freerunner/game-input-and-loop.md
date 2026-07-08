# game-input-and-loop

Applies to: `viewportModel: fullscreen_app`, `presetIds: videogame, seriousgame, freerunner`

Use this skill when generating a browser game, mini-game, interactive playable experience, or
fullscreen gamified artifact.

## Goal

The output must feel playable immediately in the sandboxed preview iframe. A game artifact is
not complete if it only renders a scene, title screen, or decorative canvas.

## Required Structure

- Include a visible play area, score/progress state, win/loss or completion condition, and restart path.
- Implement one clear core loop: read input, update state, resolve collisions/interactions, render feedback.
- Use `requestAnimationFrame` or the selected engine's native update loop; avoid timer-only gameplay.
- Track delta time or engine-provided frame time for motion that remains stable across devices.
- Keep all state in memory; do not rely on `localStorage`, IndexedDB, cookies, or browser extension APIs.

## Input Rules

- Support pointer/touch in addition to keyboard. Keyboard-only games often fail in iframe previews.
- Provide on-screen controls or direct pointer interaction for mobile and touch users.
- Make the canvas/container focusable when keyboard input is used.
- Start or focus input after a user gesture such as Play, click, tap, or pointerdown.

## Feedback Rules

- Every player action should produce visible feedback: movement, animation, score change, soundless visual cue, particle, shake, or transition.
- Show state labels such as score, lives, level, time, objective, or progress.
- On failure or success, show a clear end state and a restart action.

## Avoid

- Static mockups presented as games.
- Infinite motion with no objective.
- Hidden controls.
- External assets that can fail to load unless explicitly allowed by the preset CDN policy.
- Console-dependent instructions such as "press F12" or "check logs".

## Acceptance Checks

- A first-time user can start playing within 3 seconds.
- The game works with mouse/touch only.
- The game works after iframe reload.
- A visible state changes within the first 5 seconds of interaction.
- The artifact has a restart path without reloading the page.

Sources:

- MDN game anatomy: https://developer.mozilla.org/en-US/docs/Games/Anatomy
- MDN `requestAnimationFrame`: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
