/**
 * Shelf state of the Arcade shell (docs/specs/ARCADE_MODE_MVP.md §2): order of the games, the
 * "new" badge, recently played games and recent player names. Everything here is per device and
 * kept in localStorage; it is a convenience, never a source of truth, so every access tolerates
 * missing or blocked storage.
 */

const RECENT_GAMES_KEY = "andy-arcade:recent-games:v1";
const RECENT_PLAYERS_KEY = "andy-arcade:recent-players:v1";
const LEGACY_PLAYER_KEY = "andy-arcade:player";
const MAX_RECENT_GAMES = 12;
const MAX_RECENT_PLAYERS = 5;
const NEW_GAME_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const INITIALS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const INITIALS_LENGTH = 3;

function readList(key: string): string[] {
    try {
        const raw = window.localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) as unknown : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function writeList(key: string, list: string[]) {
    try { window.localStorage.setItem(key, JSON.stringify(list)); } catch { /* per-session only */ }
}

/** Puts `item` first, without duplicates, keeping at most `max` items. */
export function pushRecent(list: readonly string[], item: string, max: number): string[] {
    return [item, ...list.filter((existing) => existing !== item)].slice(0, max);
}

export function readRecentGames(): string[] {
    return readList(RECENT_GAMES_KEY);
}

export function rememberPlayedGame(projectId: string): string[] {
    const next = pushRecent(readRecentGames(), projectId, MAX_RECENT_GAMES);
    writeList(RECENT_GAMES_KEY, next);
    return next;
}

export function readRecentPlayers(): string[] {
    const players = readList(RECENT_PLAYERS_KEY);
    if (players.length) return players;
    try {
        const legacy = window.localStorage.getItem(LEGACY_PLAYER_KEY);
        return legacy ? [normaliseInitials(legacy)] : [];
    } catch {
        return [];
    }
}

export function rememberPlayer(name: string): string[] {
    const next = pushRecent(readRecentPlayers(), normaliseInitials(name), MAX_RECENT_PLAYERS);
    writeList(RECENT_PLAYERS_KEY, next);
    return next;
}

/** Recently played games first, in the order they were played, then the rest newest first. */
export function orderShelf<T extends { id: string; createdAt: string }>(projects: readonly T[], recentIds: readonly string[]): T[] {
    const rank = new Map(recentIds.map((id, index) => [id, index]));
    return [...projects].sort((a, b) => {
        const ra = rank.get(a.id);
        const rb = rank.get(b.id);
        if (ra !== undefined || rb !== undefined) return (ra ?? Infinity) - (rb ?? Infinity);
        return b.createdAt.localeCompare(a.createdAt);
    });
}

/** A game made in the last three days that nobody has played on this device yet. */
export function isNewGame(project: { id: string; createdAt: string }, recentIds: readonly string[], now: number): boolean {
    const created = Date.parse(project.createdAt);
    return Number.isFinite(created) && now - created < NEW_GAME_WINDOW_MS && !recentIds.includes(project.id);
}

/** Exactly three characters from the initials alphabet; anything else becomes "A". */
export function normaliseInitials(value: string): string {
    const chars = value.toUpperCase().split("").filter((char) => INITIALS_ALPHABET.includes(char)).slice(0, INITIALS_LENGTH);
    return chars.join("").padEnd(INITIALS_LENGTH, "A");
}

/** Turns the wheel of one slot by `delta` letters, wrapping around the alphabet. */
export function stepInitial(initials: string, slot: number, delta: number): string {
    const chars = normaliseInitials(initials).split("");
    const index = INITIALS_ALPHABET.indexOf(chars[slot] ?? "A");
    const size = INITIALS_ALPHABET.length;
    chars[slot] = INITIALS_ALPHABET[(((index + delta) % size) + size) % size]!;
    return chars.join("");
}

/** Writes one typed character into a slot. Returns the new initials and the next slot. */
export function typeInitial(initials: string, slot: number, char: string): { initials: string; slot: number } {
    const upper = char.toUpperCase();
    if (!INITIALS_ALPHABET.includes(upper) || upper.length !== 1) return { initials: normaliseInitials(initials), slot };
    const chars = normaliseInitials(initials).split("");
    chars[slot] = upper;
    return { initials: chars.join(""), slot: Math.min(INITIALS_LENGTH - 1, slot + 1) };
}
