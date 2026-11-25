# Arcade Games Research — Genres, Dynamics and Libraries (2026-11-25)

Two research passes made for [Arcade mode](../specs/ARCADE_MODE_MVP.md): which game genres an LLM
can generate reliably as one HTML document for a keyboard/gamepad console with a leaderboard,
which dynamics raise their quality, and which CDN libraries fit our constraints (plain
`<script src>`, sandboxed `allow-scripts` iframe, the published-page CSP).

**Evidence level.** Platform requirements (Poki, CrazyGames), the game-loop pattern and the A-Frame
input docs were read at the source. Some game-feel, roguelite and accessibility material comes from
search excerpts, a few of them from blogs or sponsored posts. Library versions, file paths, sizes and
build formats were checked against the npm registry and jsDelivr (HTTP 200 and the wrapper), but no
library was run in a browser under our CSP. Genre feasibility ratings are design judgement, not
measurements.

What was applied on 2026-11-25: the `ARCADE_PLAYABILITY_MODULE` rewrite (levels **or** escalating
tiers, quality checklist, library and audio rules) and new wheel entries (§4). The rest is a backlog.

---

## 1. Genres by generation reliability

| Reliability | Genres |
|---|---|
| High | Snake, one-button flyer, brick breaker, endless runner, falling blocks, vertical shoot 'em up |
| Medium | Platformer, maze chase, arena survival, survivor-like, tower defense, match-3, top-down racer, minigolf, solitaire, fishing/timing, local 2-player duel |
| Risky | Roguelite dungeon, rhythm (audio clock drift), sokoban (LLM-made levels are often unsolvable), physics puzzle, brawler |
| Poor fit | Idle/incremental (no game-over moment), word/typing (letters clash with the key contract, unusable with a pad) |

Typical one-shot failures: unwinnable or unsolvable hand-made levels, tunnelling collisions, unfair
spawn gaps, speed tied to the frame rate, unbounded entities, rotation/lock-delay bugs in falling
blocks, turn-queueing bugs in maze games.

Popular browser categories not yet covered (Poki): merge, cozy, drifting, ragdoll, 2-player.

## 2. Dynamics that raise quality (now in the playability block)

- **Loop:** fixed 1/60 s update with an accumulator, rendering decoupled; CrazyGames requires
  consistent physics at 144/165 Hz.
- **First seconds:** players decide within seconds (Poki); reach gameplay immediately (CrazyGames).
  Safe opening, one verb at a time, prompts that vanish after first use.
- **Fairness and progression:** no unavoidable hazard, ≥ 0.4 s reaction gap; hand-made levels as data
  with a reachability/solvability check; endless games use escalating named tiers instead of levels;
  one new element per level, a boss or milestone every few levels; seeded PRNG (e.g. mulberry32) for
  procedural content and a date seed for daily challenges.
- **Scores that rank skill:** combo/multiplier with a short chain window, risk-reward bonuses,
  integer score, no idle farming, submit once.
- **Game feel ("juice"):** immediate audio/visual response to every action, decaying screen shake,
  40–80 ms hit-stop, easing, score pop-ups, pooled particles with a cap.
- **Accessibility:** never colour alone, colour-blind-safe palette, reduced-motion toggle defaulting
  from `prefers-reduced-motion`, no flashing above 3 Hz, large text.
- **Hygiene:** storage in try/catch, no external requests, auto-pause when hidden.

## 3. Libraries

### Recommended for games (exact URLs verified on jsDelivr)

| Library | Pin | Use | Verdict |
|---|---|---|---|
| Plain Canvas 2D | — | most arcade genres | default |
| Phaser | 3.90.0 (`/npm/phaser@3.90.0/dist/phaser.min.js`) | platformers, shooters, tilemaps | adopt (frozen 3.x line, best known to LLMs) |
| Matter.js | 0.20.0 | physics puzzles | adopt |
| three.js | 0.160.0 (`build/three.min.js`, last global build) | 3D | adopt, **no addons** (`examples/js` is gone) |
| ZzFX | 1.4.0 (`/npm/zzfx@1.4.0/ZzFXMicro.min.js`, 1.2 KB) | procedural SFX | adopt (resume `zzfxX` on first key) |
| Tone.js | 15.1.22 (`/npm/tone@15.1.22/build/Tone.js`) | rhythm / music games | adopt when music matters |
| rot.js | 2.2.1 (`/npm/rot-js@2.2.1/dist/rot.min.js`) | roguelikes, FOV, A* | adopt for that genre |
| Planck.js | 1.5.1 | Box2D-style physics | maybe |
| Phaser 4 | 4.2.1 | — | maybe: removes `textures.generate`, `Geom.Point`, `postFX`, Mesh; LLMs write v3 code |
| Kaplay 3001.0.19, LittleJS 1.31.0 | — | jam-style arcade | maybe, need an API cheat-sheet |
| PixiJS | 8.23.0 (7.4.3 is what LLMs know) | renderer only | maybe, no clear need |

Avoid: Babylon.js and PlayCanvas (2.9–8.9 MB), Excalibur 1.x and melonJS (ESM-only), Rapier
(no global build), p5play (restrictive licence), p2 and PathFinding.js (unmaintained, no licence),
simplex-noise (no UMD).

### Problems in the global allowlist (`GetLlmPromptConfig.ts`) — follow-up, not applied

The global library block feeds every generation, so changes there need their own review and
snapshot updates:

- **p5 2.3.0:** p5 2.x broke 1.x idioms (async `setup`, no `preload`, new shape/type APIs) and LLM
  training data is mostly 1.x. Pin `p5@1.11.13` or add an explicit 2.x API block. (The arcade block
  now says not to use p5 for arcade games.)
- **three 0.160.0:** correct pin, but say explicitly that no addons exist in that build.
- **Phaser 3.90.0:** last 3.x release; fine, but frozen.
- **GSAP:** "Standard no charge" licence, not MIT; worth a legal look for an AI site builder.

### Sandbox and audio notes

- The published CSP allows `'unsafe-eval'` (Phaser, Pixi need it) but has no `worker-src`, so blob
  workers are blocked.
- WebAudio starts suspended until a user activation. Keys typed into the game frame count; **keys the
  Arcade shell synthesises from a gamepad do not**. A pad-only player hears nothing until a real key
  or click reaches the frame. Open point for the shell (e.g. a "press any key or click to start"
  overlay that hands focus to the frame).
- `localStorage` may throw in the opaque-origin frame: always try/catch.

## 4. Wheels and sub-presets

Added on 2026-11-25: genres snake, one-button flyer, survivor, tower defense, minigolf; styles CRT
arcade, paper cut-out, pastel cozy; two worlds; two heroes; twists daily challenge, fog of war, rising
lava, random mutators.

Backlog:

- Per-genre guidance paragraphs (e.g. platformer: tile-map arrays with reachability check, coyote
  time and jump buffer; falling blocks: 7-bag, wall kicks, lock delay, ghost piece; brick breaker:
  hit-position angle, sub-stepped collisions; maze: four distinct enemy behaviours, turn queueing,
  original layouts). Start with the six high-reliability genres.
- `vr-aframe` as a flat "3D arcade" (WebXR is likely blocked by the sandbox; WASD move, arrows turn,
  gaze reticle, Space acts) and `interactive-story` as a badged "Story" extra (Up/Down choose, Space
  confirms; score from endings found).
- Local 2-player only once the shell maps a second pad to a second key set.
- Originality: rewrite named games into mechanic lists in the prompt composer; optionally a denylist
  of franchise names checked after generation.

## Sources

- Game Programming Patterns, Game Loop — https://gameprogrammingpatterns.com/game-loop.html
- Poki developer guide — https://developers.poki.com/guide , https://developers.poki.com/guide/what-we-look-for , https://developers.poki.com/guide/requirements-quality
- Poki categories — https://poki.com/en/categories
- CrazyGames gameplay requirements — https://docs.crazygames.com/requirements/gameplay/
- itch.io tag browser — https://itch.io/games/tag-browser
- Vlambeer, action game advice — https://gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games
- "Art of Screenshake" effects breakdown — https://dkliao.itch.io/the-art-of-screenshake-recreation/devlog/451576/quick-breakdown-of-all-the-effects
- Hyper-casual design — https://www.gamedev.net/articles/game-design/game-design-and-theory/admiring-the-game-design-in-hyper-casuals-r5146/ , https://gdevelop.io/blog/casual-game-loops
- Roguelite loops — https://www.feedme.design/why-we-cant-stop-playing-these-roguelites , https://saschb2b.github.io/game-mechanics/games/hades/lessons
- Seeded daily puzzles / PRNG — https://dev.to/solsticioapp/a-daily-logic-puzzle-with-no-backend-at-all-1ef6 , https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
- Accessibility — https://gameaccessibilityguidelines.com/ , https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107
- A-Frame interactions and controllers — https://aframe.io/docs/1.6.0/introduction/interactions-and-controllers.html
- Phaser 4 release and comparison — https://github.com/phaserjs/phaser/releases/tag/v4.0.0 , https://phaser.io/news/2026/05/phaser-3-vs-phaser-4 , https://unpkg.com/phaser@4.2.1/skills/v3-to-v4-migration/SKILL.md
- Kaplay — https://github.com/kaplayjs/kaplay
- three.js UMD removal — https://discourse.threejs.org/t/umd-version-of-three-js-v-161/60912 , https://github.com/mrdoob/three.js/issues/27763 , https://github.com/mrdoob/three.js/wiki/Migration-Guide
- npm registry (`https://registry.npmjs.org/<package>`) and jsDelivr file listings (`https://data.jsdelivr.com/v1/packages/npm/<package>@<version>?structure=flat`) for every pinned version above
