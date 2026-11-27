/**
 * The Arcade runtime lives in `@andy-code-cat/contracts` (arcade.ts) because the API injects the
 * same SDK into published games. This module re-exports it for the web app.
 */
export {
    ARCADE_GAME_SOURCE, ARCADE_KEY_CODES, ARCADE_SHELL_SOURCE, ARCADE_SDK_VERSION, injectArcadeRuntime, parseArcadeGameMessage, usesArcadeSdk,
    type ArcadeGameConfig, type ArcadeGameMessage, type ArcadeKeyCode,
} from "@andy-code-cat/contracts";
