# Arcade SDK (`window.AndyArcade` v2)

**Status:** implemented, branch `feat/arcade-mobile-sdk`
**Source:** `packages/contracts/src/arcade.ts` (runtime, message contract, helpers)
**Related:** [ARCADE_MODE_MVP.md](ARCADE_MODE_MVP.md), [PLATFORM_CAPABILITY_RUNTIME.md](../architecture/PLATFORM_CAPABILITY_RUNTIME.md)

A generated game should not decide how a phone is held, how a joystick feels or how audio is
unlocked. Every game would solve these differently, most would solve them badly, and the tokens
spent on them are tokens not spent on the game. The platform therefore owns them in one script,
the Arcade SDK, and the model is told to call it instead of writing its own touch, viewport or
audio code.

## 1. Where the SDK runs

The same script is injected, before any game code, wherever a game runs:

| Place | When | Injected by |
|---|---|---|
| Arcade shell (`/arcade`) | always, for every game | `injectArcadeRuntime()` in `apps/web/app/arcade/page.tsx` |
| Workspace preview, admin version preview | when the HTML or JS references `AndyArcade` | `buildPreviewDoc()` |
| Published site | when the HTML or JS references `AndyArcade` | `PublishProject` (publish and republish) |
| ZIP export | never | — the game falls back to the keyboard |

Inside the Arcade the game runs in an iframe sandboxed with `allow-scripts allow-pointer-lock`
(opaque origin, no access to the app's storage or tokens) and talks to the shell by `postMessage`.
On a published site there is no parent: messages to the shell are not sent, and `vibrate()` calls
the browser directly.

## 2. API for the game

Every call is guarded (`if (window.AndyArcade) { … }`): a game must stay playable with the
keyboard when the SDK is absent.

| Call | Effect |
|---|---|
| `configure({ touch, buttons, orientation, lockPage })` | Once at startup. On touch devices only, draws the controls for `touch` and turns them into the keys of the playability contract. Locks the page (no scroll, rubber-banding, selection, long-press menu) unless `lockPage: false`. Reports the configuration to the shell. |
| `fit(canvas, width, height)` | Fixed internal resolution, letterboxed to the viewport, kept fitted on resize and rotation. |
| `on(name, fn)` / `off(name, fn)` | `pause`, `resume` (from the console's menu) and `gesture` (`{ type: "swipe", dir }` or `{ type: "tap" }`, in swipe and tap layouts). |
| `submitScore(n)` | Integer ≥ 0, capped at 1e9; the shell asks the player's initials and stores it. |
| `vibrate(ms)` | Haptic pulse, capped at 200 ms; ignored where vibration does not exist. |
| `menu()` / `exit()` | Open the console's pause menu / go back to the shelf. |
| `isTouch`, `inShell`, `version` | Read-only facts for the game's legend and layout. |

### Touch layouts

| `touch` | Controls | Keys pressed | Genres |
|---|---|---|---|
| `dpad` | d-pad bottom-left, face buttons bottom-right | arrows, Space/Shift/K/P | platformers, mazes, grids, puzzles |
| `joystick` | analog-style stick bottom-left, face buttons bottom-right | arrows (8 directions, dead zone, stable diagonals) | top-down, shooters, racers, arenas |
| `swipe` | none drawn: swipes and taps anywhere | swipe → tap of the arrow key, tap → Space | lanes, runners, snake, falling blocks |
| `tap` | none drawn: touching the screen | Space held while touching | one-button games |
| `pointer` | none: the game reads pointer events itself | — | aiming and dragging games |
| `none` | none | — | keyboard or gamepad only |

`buttons` picks the face buttons (`a` = Space, `b` = Shift, `x` = K, `y` = P), at most four; the
first one is drawn larger. Multi-touch works: each control captures its own pointer.

The SDK holds no library: the joystick, d-pad and gesture recogniser are about 200 lines of ES5
written for this contract, so a game never depends on a CDN for its controls. Hammer.js
(unmaintained since 2016) and ZingTouch were considered and rejected; nipplejs is a good joystick
but would be a second script to load inside every sandboxed frame. The direction and gesture logic
is mirrored by `arcadeStickDirections()` and `classifyArcadeGesture()`, and a contract test keeps
the two in step.

### Audio

Every `AudioContext` the game creates is recorded and resumed on the first real tap or key press
inside the game. If audio is still suspended 400 ms after load, a "TAP TO PLAY / PRESS ANY KEY"
splash is shown; the tap that dismisses it is the user activation the browser needs. Keys
synthesised from a gamepad are not user activations, so a gamepad-only player still needs one tap
or key press.

## 3. Messages

Game → shell (validated by `parseArcadeGameMessage()`; anything else is dropped):

| `type` | Payload |
|---|---|
| `ready` | `version` |
| `score` | `score` (integer 0–1e9) |
| `config` | `{ touch, buttons, orientation }` |
| `haptic` | `ms` (1–200) |
| `menu` | — (also sent on a real double Escape) |
| `exit` | — |

Shell → game (accepted only from `window.parent`): `key` (`code` from `ARCADE_KEY_CODES`, `down`),
`pause`, `resume`. On `pause`/`resume` the SDK releases held keys and calls the game's listeners;
a game without listeners gets a P press instead, as the playability contract requires every game
to pause on P.

## 4. The shell around the game

- **Pause menu** (⏸ button, gamepad SELECT, double Escape, `AndyArcade.menu()`): resume, restart,
  leaderboard, full screen, back to the shelf.
- **Orientation:** a game configured for landscape shows a "turn your phone" hint in portrait, and
  in full screen the shell tries `screen.orientation.lock()` (Android).
- **Full screen** on touch devices when a game starts (not available on iPhone Safari).
- **Score entry:** recent players on the device, three letter wheels (drag or ▲/▼), a simplified
  keypad on touch screens, the keyboard and the gamepad.
- **Shelf:** recently played first, a NEW badge for three days, the best score on each cartridge
  (`GET /v1/leaderboards/summary`, one request for the whole shelf), the leaderboard from the 🏆
  chip, a long-press or the gamepad X button.

## 5. Prompt contract

`ARCADE_PLAYABILITY_MODULE` (`apps/api/src/domain/entities/ProjectPreset.ts`) has an ARCADE SDK
section: never write touch controls or gesture code, call `configure` with the layout of the genre,
keep the HUD at the top when on-screen controls are drawn, use `fit`, listen to `pause`/`resume`,
use `vibrate`, and let Space also start the game (a phone has no Enter). The Arcade's new-game
wheels write the right `configure` call for the chosen genre into the prompt
(`ARCADE_GENRES[].touch`). **Reseed presets** on every deployment that takes this change
(`docs/runbooks/PRESET_RESEED.md`).

Games generated before this change do not call `configure`: they keep their own touch controls,
if any, and the SDK draws nothing over them.

## 6. Extending

A new capability is one more method on `AndyArcade`, one more message type validated in
`parseArcadeGameMessage()`, a shell handler, and — when it stores data — an API capability with a
full `{ ownerUserId, projectId, … }` scope, as the leaderboard does. The model learns it from one
line in the prompt module; it never talks to the network itself.
