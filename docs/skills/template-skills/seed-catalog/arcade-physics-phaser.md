# arcade-physics-phaser

Applies to: `presetIds: videogame, seriousgame, freerunner`, `tags: game, physics`

Use this skill when Phaser is the selected or implied game engine.

## Phaser Baseline

- Use one explicit `Phaser.Scene` with `preload`, `create`, and `update`.
- Configure Arcade Physics when the game needs platformer, runner, top-down, collision, projectile, or obstacle mechanics.
- Use `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }` for iframe-friendly responsiveness.
- Keep procedural shapes acceptable when external assets are unavailable.

## Gameplay Loop

- `create`: build player, obstacles, collectibles, UI text, input, physics groups, and colliders.
- `update`: read input, move actors, spawn/despawn objects, update difficulty, and check end states.
- Use physics bodies for collisions instead of manual bounding boxes when Arcade Physics is active.
- Use overlap/collider callbacks for score, damage, pickups, and game-over.

## Input

- Use Phaser pointer events for mouse and touch. Phaser unifies mouse and touch through pointer input.
- Use keyboard only as an enhancement.
- Add an on-screen control surface for movement/jump/fire when keyboard controls are included.
- Call `setInteractive()` on clickable game objects and listen for pointer events.

## Difficulty And Juice

- Add at least one ramp: spawn rate, speed, density, countdown, or score threshold.
- Add visual feedback: tween on pickup, flash on hit, camera shake, particle burst, squash/stretch, or score pop.
- Keep failure fair: obstacles must be visible before impact and player controls must respond immediately.

## Avoid

- A Phaser scene that only displays sprites/text.
- Keyboard-only movement.
- Missing restart after game-over.
- Offscreen spawns that never despawn.
- Storing game state in browser storage.

## Acceptance Checks

- Player can move or act with pointer/touch.
- At least one physics interaction changes score/lives/progress.
- Game-over and restart both work.
- Resizing the iframe keeps the game visible and centered.

Sources:

- Phaser input concepts: https://docs.phaser.io/phaser/concepts/input
