/**
 * Arcade "new game" recipes (docs/specs/ARCADE_MODE_MVP.md §2): a handful of wheels a player can
 * turn with a gamepad, plus a dice roll, composed into one Vibe prompt. The prompt is plain text for
 * the existing pipeline: VibeClassify picks the game preset from the mechanics and controls it
 * names, and the preset's ARCADE PLAYABILITY block does the rest.
 */

export interface ArcadeOption {
    id: string;
    en: string;
    it: string;
    /** Wording sent to the model. */
    prompt: string;
}

export const ARCADE_GAME_PRESET_IDS = ["videogame", "freerunner", "seriousgame", "game3d"] as const;

export function isArcadeProject(project: { presetId?: string }): boolean {
    return Boolean(project.presetId && (ARCADE_GAME_PRESET_IDS as readonly string[]).includes(project.presetId));
}

export const ARCADE_GENRES: ArcadeOption[] = [
    { id: "platformer", en: "Platformer", it: "Platform", prompt: "a side-scrolling platformer: run, jump between platforms, avoid enemies and pits, collect items" },
    { id: "shmup", en: "Space shooter", it: "Sparatutto spaziale", prompt: "a vertical shoot 'em up: fly, dodge bullets, shoot waves of enemies, a boss at the end of each level" },
    { id: "maze", en: "Maze chase", it: "Labirinto", prompt: "a maze chase: collect every dot in the maze while enemies hunt you, power-ups turn the tables for a few seconds" },
    { id: "blocks", en: "Falling blocks", it: "Blocchi che cadono", prompt: "a falling-block puzzle: rotate and place pieces, clear full lines, speed rises with each level" },
    { id: "runner", en: "Endless runner", it: "Corsa infinita", prompt: "an endless runner: the hero runs on its own, jump and slide over obstacles, distance and coins make the score" },
    { id: "breakout", en: "Brick breaker", it: "Spacca mattoni", prompt: "a brick breaker: move a paddle, bounce the ball, break every brick, catch power-ups" },
    { id: "racer", en: "Top-down racer", it: "Corse dall'alto", prompt: "a top-down racer: steer around a track, overtake rivals, finish laps before the timer runs out" },
    { id: "arena", en: "Arena survival", it: "Sopravvivenza in arena", prompt: "an arena survival game: move around a closed arena, attack waves of enemies, survive as long as possible" },
];

export const ARCADE_STYLES: ArcadeOption[] = [
    { id: "pixel-8bit", en: "8-bit pixel", it: "Pixel 8-bit", prompt: "8-bit pixel art drawn on a low-resolution canvas scaled up with image-rendering: pixelated, a small retro palette, chiptune-style beeps with the Web Audio API" },
    { id: "pixel-16bit", en: "16-bit pixel", it: "Pixel 16-bit", prompt: "16-bit pixel art with parallax backgrounds and a richer palette" },
    { id: "neon-vector", en: "Neon vector", it: "Vettoriale neon", prompt: "glowing neon vector lines on a black background, like an old vector arcade cabinet" },
    { id: "handheld", en: "Handheld green", it: "Portatile verde", prompt: "a four-shade green monochrome palette, like an old handheld console" },
    { id: "lowpoly-3d", en: "Low-poly 3D", it: "3D low-poly", prompt: "simple low-poly 3D with three.js and a fixed or follow camera" },
];

export const ARCADE_SETTINGS: ArcadeOption[] = [
    { id: "neon-city", en: "Neon city", it: "Città al neon", prompt: "a rainy neon city at night" },
    { id: "space-station", en: "Space station", it: "Stazione spaziale", prompt: "an abandoned space station" },
    { id: "haunted-castle", en: "Haunted castle", it: "Castello stregato", prompt: "a haunted castle full of friendly-looking ghosts" },
    { id: "underwater", en: "Underwater", it: "Sott'acqua", prompt: "a coral reef deep underwater" },
    { id: "jungle-temple", en: "Jungle temple", it: "Tempio nella giungla", prompt: "a lost temple in the jungle" },
    { id: "candy-land", en: "Candy land", it: "Mondo di caramelle", prompt: "a land made of sweets and candy" },
];

export const ARCADE_HEROES: ArcadeOption[] = [
    { id: "cat-astronaut", en: "Cat astronaut", it: "Gatto astronauta", prompt: "a cat astronaut" },
    { id: "robot-chef", en: "Robot chef", it: "Robot cuoco", prompt: "a small robot chef" },
    { id: "tiny-dragon", en: "Tiny dragon", it: "Draghetto", prompt: "a tiny dragon who cannot fly yet" },
    { id: "skater-ghost", en: "Skater ghost", it: "Fantasma skater", prompt: "a ghost on a skateboard" },
    { id: "snail-knight", en: "Snail knight", it: "Lumaca cavaliere", prompt: "a brave snail in armour" },
];

export const ARCADE_TWISTS: ArcadeOption[] = [
    { id: "none", en: "No twist", it: "Nessun twist", prompt: "" },
    { id: "gravity-flip", en: "Gravity flips", it: "Gravità invertita", prompt: "gravity flips upside down at every new level" },
    { id: "time-still", en: "Time moves when you move", it: "Il tempo scorre se ti muovi", prompt: "enemies and bullets move only while the hero moves" },
    { id: "one-button", en: "One-button controls", it: "Un solo pulsante", prompt: "the whole game is played with the primary action button only" },
    { id: "shrinking", en: "Shrinking world", it: "Mondo che si restringe", prompt: "the playfield shrinks a little every few seconds" },
];

/** Every Arcade prompt starts with this line: the shell recognises its own runs by it. */
export const ARCADE_PROMPT_PREFIX = "Create an original, complete browser videogame for the Andy Arcade console:";

export interface ArcadeRecipe {
    genre: string;
    style: string;
    setting: string;
    hero: string;
    twist: string;
    extra: string;
}

export const ARCADE_WHEELS = [
    { key: "genre", options: ARCADE_GENRES },
    { key: "style", options: ARCADE_STYLES },
    { key: "setting", options: ARCADE_SETTINGS },
    { key: "hero", options: ARCADE_HEROES },
    { key: "twist", options: ARCADE_TWISTS },
] as const;

function pick(options: ArcadeOption[], id: string): ArcadeOption {
    return options.find((option) => option.id === id) ?? options[0]!;
}

export function randomArcadeRecipe(random: () => number = Math.random): ArcadeRecipe {
    const draw = (options: ArcadeOption[]) => options[Math.min(options.length - 1, Math.floor(random() * options.length))]!.id;
    return {
        genre: draw(ARCADE_GENRES),
        style: draw(ARCADE_STYLES),
        setting: draw(ARCADE_SETTINGS),
        hero: draw(ARCADE_HEROES),
        twist: draw(ARCADE_TWISTS),
        extra: "",
    };
}

export function buildArcadeGamePrompt(recipe: ArcadeRecipe): string {
    const genre = pick(ARCADE_GENRES, recipe.genre);
    const style = pick(ARCADE_STYLES, recipe.style);
    const setting = pick(ARCADE_SETTINGS, recipe.setting);
    const hero = pick(ARCADE_HEROES, recipe.hero);
    const twist = pick(ARCADE_TWISTS, recipe.twist);
    const lines = [
        `${ARCADE_PROMPT_PREFIX} ${genre.prompt}.`,
        `Visual style: ${style.prompt}.`,
        `Setting: ${setting.prompt}. Main character: ${hero.prompt}, with an original name you invent.`,
        twist.prompt ? `Twist: ${twist.prompt}.` : "",
        recipe.extra.trim() ? `Player's own idea: ${recipe.extra.trim().slice(0, 600)}` : "",
        "Gameplay: a start screen with the title and a controls legend, at least three levels of rising difficulty, score and lives in the HUD, game over with an instant restart.",
        "Controls: WASD or arrow keys to move, Space for the main action, Shift for the second action, Enter to start, P to pause.",
        "Everything must be original: if the idea recalls an existing game, keep only the mechanics and invent the title, characters and art.",
    ];
    return lines.filter(Boolean).join("\n");
}
