/**
 * Arcade "new game" recipes (docs/specs/ARCADE_MODE_MVP.md §2): a handful of wheels a player can
 * turn with a gamepad, plus a dice roll, composed into one Vibe prompt. The prompt is plain text for
 * the existing pipeline: VibeClassify picks the game preset from the mechanics and controls it
 * names, and the preset's ARCADE PLAYABILITY block does the rest.
 */

import { ARCADE_GAME_PRESET_IDS, type ArcadeTouchButton, type ArcadeTouchLayout } from "@andy-code-cat/contracts";

export { ARCADE_GAME_PRESET_IDS };

export interface ArcadeOption {
    id: string;
    en: string;
    it: string;
    /** Wording sent to the model. */
    prompt: string;
}

/** A genre also fixes how it plays on a phone: the SDK layout and the face buttons it shows. */
export interface ArcadeGenre extends ArcadeOption {
    touch: ArcadeTouchLayout;
    buttons: ArcadeTouchButton[];
}

export function isArcadeProject(project: { presetId?: string }): boolean {
    return Boolean(project.presetId && (ARCADE_GAME_PRESET_IDS as readonly string[]).includes(project.presetId));
}

export const ARCADE_GENRES: ArcadeGenre[] = [
    { id: "platformer", en: "Platformer", it: "Platform", prompt: "a side-scrolling platformer: run, jump between platforms, avoid enemies and pits, collect items", touch: "dpad", buttons: ["a", "b"] },
    { id: "shmup", en: "Space shooter", it: "Sparatutto spaziale", prompt: "a vertical shoot 'em up: fly, dodge bullets, shoot waves of enemies, a boss at the end of each level", touch: "joystick", buttons: ["a", "b"] },
    { id: "maze", en: "Maze chase", it: "Labirinto", prompt: "a maze chase: collect every dot in the maze while enemies hunt you, power-ups turn the tables for a few seconds", touch: "dpad", buttons: [] },
    { id: "blocks", en: "Falling blocks", it: "Blocchi che cadono", prompt: "a falling-block puzzle: rotate and place pieces, clear full lines, speed rises with each level", touch: "swipe", buttons: [] },
    { id: "runner", en: "Endless runner", it: "Corsa infinita", prompt: "an endless runner: the hero runs on its own, jump and slide over obstacles, distance and coins make the score", touch: "swipe", buttons: [] },
    { id: "breakout", en: "Brick breaker", it: "Spacca mattoni", prompt: "a brick breaker: move a paddle, bounce the ball, break every brick, catch power-ups", touch: "dpad", buttons: ["a"] },
    { id: "racer", en: "Top-down racer", it: "Corse dall'alto", prompt: "a top-down racer: steer around a track, overtake rivals, finish laps before the timer runs out", touch: "joystick", buttons: ["a"] },
    { id: "arena", en: "Arena survival", it: "Sopravvivenza in arena", prompt: "an arena survival game: move around a closed arena, attack waves of enemies, survive as long as possible", touch: "joystick", buttons: ["a", "b"] },
    { id: "snake", en: "Snake", it: "Serpente", prompt: "a snake game on a grid: steer the growing snake to food, never bite yourself or the walls, speed rises with length", touch: "swipe", buttons: [] },
    { id: "flapper", en: "One-button flyer", it: "Volo a un tasto", prompt: "a one-button flyer: Space flaps upward against gravity through gaps in endless obstacles generated from a seed", touch: "tap", buttons: [] },
    { id: "survivor", en: "Survivor", it: "Sopravvissuto", prompt: "a survivor-like: the hero moves and weapons fire automatically at the nearest enemy, collect XP gems and pick one of three upgrades at each level-up (the game pauses while choosing)", touch: "joystick", buttons: ["a"] },
    { id: "towers", en: "Tower defense", it: "Difesa a torri", prompt: "a tower defense: enemies walk a fixed path in waves, move a grid cursor and place or upgrade three tower types with the gold you earn", touch: "dpad", buttons: ["a", "b"] },
    { id: "minigolf", en: "Minigolf", it: "Minigolf", prompt: "a minigolf course of 9 holes: aim with left/right, hold Space to charge the shot power, fewer strokes give a higher integer score", touch: "dpad", buttons: ["a"] },
];

export const ARCADE_STYLES: ArcadeOption[] = [
    { id: "pixel-8bit", en: "8-bit pixel", it: "Pixel 8-bit", prompt: "8-bit pixel art drawn on a low-resolution canvas scaled up with image-rendering: pixelated, a small retro palette, chiptune-style beeps with the Web Audio API" },
    { id: "pixel-16bit", en: "16-bit pixel", it: "Pixel 16-bit", prompt: "16-bit pixel art with parallax backgrounds and a richer palette" },
    { id: "neon-vector", en: "Neon vector", it: "Vettoriale neon", prompt: "glowing neon vector lines on a black background, like an old vector arcade cabinet" },
    { id: "handheld", en: "Handheld green", it: "Portatile verde", prompt: "a four-shade green monochrome palette, like an old handheld console" },
    { id: "lowpoly-3d", en: "Low-poly 3D", it: "3D low-poly", prompt: "simple low-poly 3D with three.js and a fixed or follow camera" },
    { id: "crt-arcade", en: "CRT arcade", it: "Cabinato CRT", prompt: "a glowing CRT arcade look: bright sprites drawn with canvas shapes, a CSS scanline overlay and a soft vignette" },
    { id: "paper-cut", en: "Paper cut-out", it: "Carta ritagliata", prompt: "layered paper cut-out shapes with soft drop shadows and a warm paper palette" },
    { id: "pastel-cozy", en: "Pastel cozy", it: "Pastello cozy", prompt: "flat pastel vector shapes, rounded corners and a calm, cozy palette" },
];

export const ARCADE_SETTINGS: ArcadeOption[] = [
    { id: "neon-city", en: "Neon city", it: "Città al neon", prompt: "a rainy neon city at night" },
    { id: "space-station", en: "Space station", it: "Stazione spaziale", prompt: "an abandoned space station" },
    { id: "haunted-castle", en: "Haunted castle", it: "Castello stregato", prompt: "a haunted castle full of friendly-looking ghosts" },
    { id: "underwater", en: "Underwater", it: "Sott'acqua", prompt: "a coral reef deep underwater" },
    { id: "jungle-temple", en: "Jungle temple", it: "Tempio nella giungla", prompt: "a lost temple in the jungle" },
    { id: "candy-land", en: "Candy land", it: "Mondo di caramelle", prompt: "a land made of sweets and candy" },
    { id: "clockwork-city", en: "Clockwork city", it: "Città a orologeria", prompt: "a city of gears and brass towers" },
    { id: "cloud-kingdom", en: "Cloud kingdom", it: "Regno delle nuvole", prompt: "floating islands in a sky of clouds" },
];

export const ARCADE_HEROES: ArcadeOption[] = [
    { id: "cat-astronaut", en: "Cat astronaut", it: "Gatto astronauta", prompt: "a cat astronaut" },
    { id: "robot-chef", en: "Robot chef", it: "Robot cuoco", prompt: "a small robot chef" },
    { id: "tiny-dragon", en: "Tiny dragon", it: "Draghetto", prompt: "a tiny dragon who cannot fly yet" },
    { id: "skater-ghost", en: "Skater ghost", it: "Fantasma skater", prompt: "a ghost on a skateboard" },
    { id: "snail-knight", en: "Snail knight", it: "Lumaca cavaliere", prompt: "a brave snail in armour" },
    { id: "paper-plane", en: "Paper plane", it: "Aereo di carta", prompt: "a brave paper plane" },
    { id: "mushroom", en: "Tiny mushroom", it: "Funghetto", prompt: "a tiny walking mushroom" },
];

export const ARCADE_TWISTS: ArcadeOption[] = [
    { id: "none", en: "No twist", it: "Nessun twist", prompt: "" },
    { id: "gravity-flip", en: "Gravity flips", it: "Gravità invertita", prompt: "gravity flips upside down at every new level" },
    { id: "time-still", en: "Time moves when you move", it: "Il tempo scorre se ti muovi", prompt: "enemies and bullets move only while the hero moves" },
    { id: "one-button", en: "One-button controls", it: "Un solo pulsante", prompt: "the whole game is played with the primary action button only" },
    { id: "shrinking", en: "Shrinking world", it: "Mondo che si restringe", prompt: "the playfield shrinks a little every few seconds" },
    { id: "daily-seed", en: "Daily challenge", it: "Sfida del giorno", prompt: "every level is generated from a seed made from today's date, so all players face the same layout today" },
    { id: "fog", en: "Fog of war", it: "Nebbia", prompt: "the hero sees only a circle of light around them" },
    { id: "rising-lava", en: "Rising lava", it: "Lava che sale", prompt: "a deadly boundary slowly chases the hero, so standing still is never safe" },
    { id: "mutators", en: "Random mutators", it: "Mutatori casuali", prompt: "every 15 seconds a random mutator switches on for a while (low gravity, double speed, giant enemies, mirrored controls), announced on screen" },
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
    const genre = ARCADE_GENRES.find((option) => option.id === recipe.genre) ?? ARCADE_GENRES[0]!;
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
        "Controls: WASD or arrow keys to move, Space for the main action, Shift for the second action, Enter or Space to start, P to pause.",
        `Touch: call AndyArcade.configure({ touch: "${genre.touch}", buttons: ${JSON.stringify(genre.buttons)}, orientation: "${genre.touch === "swipe" || genre.touch === "tap" ? "portrait" : "landscape"}" }) as the ARCADE SDK rules say; do not draw touch controls yourself.`,
        "Everything must be original: if the idea recalls an existing game, keep only the mechanics and invent the title, characters and art.",
    ];
    return lines.filter(Boolean).join("\n");
}
