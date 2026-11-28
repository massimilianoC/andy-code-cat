"use client";

/**
 * Andy Arcade (docs/specs/ARCADE_MODE_MVP.md): the same platform, seen as a game console.
 *
 * A mode is a shell over the shared core, not a fork: it lists only the projects made with the
 * game presets, plays their active version in a sandboxed frame with the Arcade SDK, keeps per-game
 * leaderboards through the platform capability, and creates new games through the normal
 * background Vibe run. Everything is reachable with touch, a keyboard or a gamepad.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
    BACKGROUND_RUN_TERMINAL_STATUSES, computeBackgroundRunProgress,
    type BackgroundRunDto, type LeaderboardEntryDto, type LeaderboardProjectSummaryDto,
} from "@andy-code-cat/contracts";
import { getToken } from "@/lib/token-store";
import { listProjects, type Project } from "@/lib/api/projects";
import { listBackgroundRuns, startBackgroundRun } from "@/lib/api/backgroundRuns";
import { getLeaderboard, getLeaderboardSummary, getPreviewSnapshot, submitLeaderboardScore } from "@/lib/api/arcade";
import { buildPreviewDoc } from "@/lib/preview/buildPreviewDoc";
import { fetchThumbnailBlobUrl } from "@/components/ProjectCard";
import { ArcadeInitialsEntry } from "@/components/arcade/ArcadeInitialsEntry";
import { ArcadeLeaderboardSheet, ArcadePauseMenu, PAUSE_ITEMS, type PauseItem } from "@/components/arcade/ArcadeSheets";
import { ARCADE_SHELL_SOURCE, injectArcadeRuntime, parseArcadeGameMessage, type ArcadeGameConfig } from "@/lib/arcade/arcadeRuntime";
import {
    ACTION_KEY, ARCADE_ACTIONS, DEFAULT_BINDINGS, connectedPads, describeBinding, detectBinding, loadBindings, saveBindings,
    useArcadeGamepad, type ArcadeAction, type GamepadBindings,
} from "@/lib/arcade/gamepad";
import {
    ARCADE_PROMPT_PREFIX, ARCADE_WHEELS, buildArcadeGamePrompt, isArcadeProject, randomArcadeRecipe, type ArcadeOption, type ArcadeRecipe,
} from "@/lib/arcade/arcadeRecipe";
import {
    isNewGame, normaliseInitials, orderShelf, readRecentGames, readRecentPlayers, rememberPlayedGame, rememberPlayer, stepInitial, typeInitial,
} from "@/lib/arcade/shelf";

type View = "library" | "play" | "new" | "controls";
type Sheet = { project: Project; entries: LeaderboardEntryDto[] | null; highlightId?: string; rank?: number; mode: "shelf" | "gameover" | "pause" };

const KEY_TO_ACTION: Record<string, ArcadeAction> = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    Enter: "start", Space: "a", Escape: "b", Backspace: "b", KeyX: "x",
};
const KEYBOARD_LABEL: Record<ArcadeAction, string> = {
    up: "W / ↑", down: "S / ↓", left: "A / ←", right: "D / →", a: "Space", b: "Shift", x: "K", y: "P", start: "Enter", select: "Esc Esc",
};
const LONG_PRESS_MS = 480;
const SWIPE_PX = 40;

function isTerminal(run: BackgroundRunDto) {
    return (BACKGROUND_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status);
}

function useCoarsePointer(): boolean {
    const [coarse, setCoarse] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(pointer: coarse)");
        const update = () => setCoarse(query.matches || navigator.maxTouchPoints > 0);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return coarse;
}

function usePortrait(): boolean {
    const [portrait, setPortrait] = useState(false);
    useEffect(() => {
        const query = window.matchMedia("(orientation: portrait)");
        const update = () => setPortrait(query.matches);
        update();
        query.addEventListener("change", update);
        return () => query.removeEventListener("change", update);
    }, []);
    return portrait;
}

async function enterFullscreen() {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen({ navigationUI: "hide" });
        }
    } catch { /* iPhone Safari and embedded browsers: the page simply stays as it is */ }
}

async function leaveFullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* already gone */ }
}

/** Library tile: thumbnail of the active version, or a generated cartridge face. Long-press or right-click opens the leaderboard. */
function Cartridge(props: {
    project: Project; focused: boolean; isNew: boolean; best?: LeaderboardProjectSummaryDto; onPlay: () => void; onBoard: () => void;
}) {
    const { project, focused, isNew, best, onPlay, onBoard } = props;
    const { t } = useTranslation();
    const [thumb, setThumb] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const press = useRef<{ timer: number; fired: boolean; x: number; y: number } | null>(null);

    useEffect(() => {
        if (!project.activeThumbnailSnapshotId) return;
        let url: string | null = null;
        let cancelled = false;
        void fetchThumbnailBlobUrl(project.id, project.activeThumbnailSnapshotId).then((result) => {
            if (cancelled) { if (result) URL.revokeObjectURL(result); return; }
            url = result;
            setThumb(result);
        });
        return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
    }, [project.id, project.activeThumbnailSnapshotId]);

    useEffect(() => { if (focused) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [focused]);

    const cancelPress = () => { if (press.current) window.clearTimeout(press.current.timer); };
    const hue = (project.id.charCodeAt(0) * 37 + project.id.charCodeAt(project.id.length - 1) * 11) % 360;

    return (
        <div ref={ref} className={`relative transition-transform duration-150 ${focused ? "z-10 scale-[1.04]" : ""}`}>
            <button
                type="button"
                onPointerDown={(event) => {
                    cancelPress();
                    press.current = { fired: false, x: event.clientX, y: event.clientY, timer: window.setTimeout(() => { if (press.current) press.current.fired = true; navigator.vibrate?.(15); onBoard(); }, LONG_PRESS_MS) };
                }}
                onPointerMove={(event) => {
                    const current = press.current;
                    if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) cancelPress();
                }}
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onContextMenu={(event) => { event.preventDefault(); cancelPress(); if (!press.current?.fired) onBoard(); }}
                onClick={() => { if (press.current?.fired) { press.current = null; return; } onPlay(); }}
                className={`group relative block aspect-[4/3] w-full touch-manipulation select-none overflow-hidden rounded-2xl border-4 border-solid text-left [-webkit-touch-callout:none] active:scale-[0.97] ${focused ? "border-yellow-300 shadow-[0_0_32px_rgba(253,224,71,0.55)]" : "border-slate-700"}`}
                style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 25%), hsl(${(hue + 60) % 360} 70% 12%))` }}
            >
                {thumb ? <img src={thumb} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover object-top opacity-90" /> : null}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-2.5 pb-2 pt-6 sm:px-3">
                    <span className="line-clamp-2 font-mono text-xs font-bold uppercase leading-tight tracking-wide text-white sm:text-base">{project.name}</span>
                </span>
                {isNew ? <span className="absolute left-2 top-2 rounded-md bg-pink-500 px-2 py-0.5 text-[10px] font-black tracking-widest text-white shadow sm:text-xs">{t("arcade.newBadge")}</span> : null}
            </button>
            <button type="button" onClick={onBoard} aria-label={t("arcade.leaderboard")}
                className="absolute right-1.5 top-1.5 flex min-h-9 items-center gap-1 rounded-full border-0 bg-black/70 px-2.5 text-xs font-bold text-yellow-300 backdrop-blur active:scale-95 sm:text-sm">
                🏆 {best ? best.best.score.toLocaleString() : ""}
            </button>
        </div>
    );
}

/** One wheel of the new-game screen: arrows, or a horizontal swipe across the row. */
function WheelRow(props: { label: string; value: string; active: boolean; onFocus: () => void; onTurn: (delta: number) => void }) {
    const { label, value, active, onFocus, onTurn } = props;
    const start = useRef<{ x: number; y: number } | null>(null);
    return (
        <div
            onPointerDown={(event) => { onFocus(); start.current = { x: event.clientX, y: event.clientY }; }}
            onPointerUp={(event) => {
                const from = start.current;
                start.current = null;
                if (!from) return;
                const dx = event.clientX - from.x;
                if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(event.clientY - from.y)) onTurn(dx < 0 ? 1 : -1);
            }}
            className={`flex touch-pan-y select-none flex-col gap-1 rounded-xl border-4 border-solid px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3 ${active ? "border-yellow-300" : "border-slate-700"}`}
        >
            <span className="text-sm uppercase tracking-widest text-slate-400 sm:text-xl sm:normal-case sm:tracking-normal">{label}</span>
            <span className="flex items-center justify-between gap-2 sm:gap-4">
                <button type="button" className="h-11 w-11 rounded-lg border-0 bg-slate-800/70 text-xl text-cyan-300 active:scale-90" onClick={() => onTurn(-1)} aria-label="previous">◀</button>
                <span className="flex-1 text-center text-lg font-bold sm:min-w-[12rem] sm:text-xl">{value}</span>
                <button type="button" className="h-11 w-11 rounded-lg border-0 bg-slate-800/70 text-xl text-cyan-300 active:scale-90" onClick={() => onTurn(1)} aria-label="next">▶</button>
            </span>
        </div>
    );
}

export default function ArcadePage() {
    const router = useRouter();
    const { t, i18n } = useTranslation();
    const touch = useCoarsePointer();
    const portrait = usePortrait();
    const [token, setToken] = useState<string | null>(null);
    const [view, setView] = useState<View>("library");
    const [projects, setProjects] = useState<Project[]>([]);
    const [runs, setRuns] = useState<BackgroundRunDto[]>([]);
    const [best, setBest] = useState<Map<string, LeaderboardProjectSummaryDto>>(new Map());
    const [recentGames, setRecentGames] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [focus, setFocus] = useState(0);
    const [columns, setColumns] = useState(4);
    const [sheet, setSheet] = useState<Sheet | null>(null);
    const [ready, setReady] = useState<{ projectId: string; name: string } | null>(null);
    const forgingIds = useRef<Set<string>>(new Set());

    // Play
    const [game, setGame] = useState<Project | null>(null);
    const [gameDoc, setGameDoc] = useState<string | null>(null);
    const [gameKey, setGameKey] = useState(0);
    const [gameConfig, setGameConfig] = useState<ArcadeGameConfig | null>(null);
    const [rotateDismissed, setRotateDismissed] = useState(false);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [paused, setPaused] = useState(false);
    const [pauseFocus, setPauseFocus] = useState(0);
    const [pendingScore, setPendingScore] = useState<number | null>(null);
    const [initials, setInitials] = useState("AAA");
    const [initialsSlot, setInitialsSlot] = useState(0);
    const [recentPlayers, setRecentPlayers] = useState<string[]>([]);
    const [saving, setSaving] = useState(false);

    // New game
    const [recipe, setRecipe] = useState<ArcadeRecipe>(() => ({ genre: "platformer", style: "pixel-8bit", setting: "neon-city", hero: "cat-astronaut", twist: "none", extra: "" }));
    const [newFocus, setNewFocus] = useState(0);
    const [creating, setCreating] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    // Controls
    const [remap, setRemap] = useState<{ padIndex: number; step: number; bindings: GamepadBindings } | null>(null);
    const [pads, setPads] = useState<Gamepad[]>([]);

    const lang = i18n.language?.startsWith("en") ? "en" : "it";
    const label = useCallback((option: ArcadeOption) => (lang === "en" ? option.en : option.it), [lang]);

    useEffect(() => {
        const tok = getToken();
        if (!tok) { router.replace("/login"); return; }
        setToken(tok);
        const players = readRecentPlayers();
        setRecentPlayers(players);
        setInitials(players[0] ?? "AAA");
        setRecentGames(readRecentGames());
    }, [router]);

    useEffect(() => {
        const update = () => setColumns(window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : 2);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const loadLibrary = useCallback(async (tok: string) => {
        try {
            const [{ projects: all }, { runs: recent }, summary] = await Promise.all([
                listProjects(tok),
                listBackgroundRuns(tok, 20),
                getLeaderboardSummary(tok).catch(() => ({ games: [] as LeaderboardProjectSummaryDto[] })),
            ]);
            setProjects(all.filter(isArcadeProject));
            const arcadeRuns = recent.filter((run) => run.prompt.startsWith(ARCADE_PROMPT_PREFIX));
            // A run that was forging and is now done: tell the player, wherever they are.
            const landed = arcadeRuns.find((run) => run.status === "done" && forgingIds.current.has(run.id));
            if (landed) setReady({ projectId: landed.projectId, name: landed.projectName ?? t("arcade.newGame") });
            forgingIds.current = new Set(arcadeRuns.filter((run) => !isTerminal(run)).map((run) => run.id));
            setRuns(arcadeRuns);
            setBest(new Map(summary.games.map((row) => [row.projectId, row])));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => { if (token) void loadLibrary(token); }, [token, loadLibrary]);

    const shelf = useMemo(() => orderShelf(projects, recentGames), [projects, recentGames]);
    const forging = useMemo(() => runs.filter((run) => !isTerminal(run)), [runs]);
    const failedRecently = useMemo(() => runs.filter((run) => run.status === "failed").slice(0, 2), [runs]);

    // While a game is being made, refresh the shelf until it lands (also while playing another one).
    useEffect(() => {
        if (!token || !forging.length) return;
        const timer = window.setInterval(() => void loadLibrary(token), 8000);
        return () => window.clearInterval(timer);
    }, [token, forging.length, loadLibrary]);

    // Library focus: 0 = new game, 1 = controls, 2.. = games.
    const libraryItems = 2 + shelf.length;

    const postToGame = useCallback((message: Record<string, unknown>) => {
        frameRef.current?.contentWindow?.postMessage({ source: ARCADE_SHELL_SOURCE, ...message }, "*");
    }, []);

    const openGame = useCallback(async (project: Project) => {
        if (!token) return;
        if (!project.activeSnapshotId) { setNotice(t("arcade.noVersion")); return; }
        if (touch) void enterFullscreen(); // still inside the tap that opened the game
        setSheet(null);
        setGame(project);
        setGameDoc(null);
        setGameConfig(null);
        setRotateDismissed(false);
        setPaused(false);
        setPendingScore(null);
        setView("play");
        setRecentGames(rememberPlayedGame(project.id));
        try {
            const { snapshot } = await getPreviewSnapshot(token, project.id, project.activeSnapshotId);
            const { doc } = buildPreviewDoc(snapshot.artifacts.html, snapshot.artifacts.css, snapshot.artifacts.js);
            setGameDoc(injectArcadeRuntime(doc));
            setGameKey((key) => key + 1);
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
            setView("library");
        }
    }, [token, t, touch]);

    const backToLibrary = useCallback(() => {
        void leaveFullscreen();
        setView("library");
        setGame(null);
        setGameDoc(null);
        setGameConfig(null);
        setPaused(false);
        setPendingScore(null);
        setSheet(null);
        if (token) void loadLibrary(token);
    }, [token, loadLibrary]);

    const restartGame = useCallback(() => {
        setPendingScore(null);
        setSheet(null);
        setPaused(false);
        setGameConfig(null);
        setGameKey((key) => key + 1);
    }, []);

    const showBoard = useCallback(async (project: Project, mode: Sheet["mode"], extra?: Partial<Sheet>) => {
        setSheet({ project, entries: extra?.entries ?? null, highlightId: extra?.highlightId, rank: extra?.rank, mode });
        if (extra?.entries || !token) return;
        try {
            const { entries } = await getLeaderboard(token, project.id);
            setSheet((current) => (current?.project.id === project.id ? { ...current, entries } : current));
        } catch {
            setSheet((current) => (current?.project.id === project.id ? { ...current, entries: [] } : current));
        }
    }, [token]);

    const pauseGame = useCallback(() => {
        if (paused) return;
        postToGame({ type: "pause" });
        setPaused(true);
        setPauseFocus(0);
        frameRef.current?.blur();
        window.focus();
    }, [paused, postToGame]);

    const resumeGame = useCallback(() => {
        setPaused(false);
        setSheet(null);
        postToGame({ type: "resume" });
        frameRef.current?.focus();
    }, [postToGame]);

    const choosePause = useCallback((item: PauseItem) => {
        if (item === "resume") resumeGame();
        if (item === "restart") restartGame();
        if (item === "leaderboard" && game) void showBoard(game, "pause");
        if (item === "fullscreen") void (document.fullscreenElement ? leaveFullscreen() : enterFullscreen());
        if (item === "shelf") backToLibrary();
    }, [resumeGame, restartGame, game, showBoard, backToLibrary]);

    const sendKey = useCallback((action: ArcadeAction, down: boolean) => {
        const code = ACTION_KEY[action];
        if (code) postToGame({ type: "key", code, down });
    }, [postToGame]);

    const submitScore = useCallback(async (name?: string) => {
        if (!token || !game || pendingScore === null || saving) return;
        const player = normaliseInitials(name ?? initials);
        setRecentPlayers(rememberPlayer(player));
        setInitials(player);
        setSaving(true);
        try {
            const result = await submitLeaderboardScore(token, game.id, { player, score: pendingScore });
            void showBoard(game, "gameover", { entries: result.top, highlightId: result.entry.id, rank: result.rank });
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
            void showBoard(game, "gameover");
        } finally {
            setSaving(false);
            setPendingScore(null);
        }
    }, [token, game, pendingScore, saving, initials, showBoard]);

    const skipScore = useCallback(() => {
        setPendingScore(null);
        if (game) void showBoard(game, "gameover");
    }, [game, showBoard]);

    // Messages from the game frame: only from our own frame, only well-formed.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
            const message = parseArcadeGameMessage(event.data);
            if (!message) return;
            if (message.type === "ready") frameRef.current.focus();
            if (message.type === "exit") backToLibrary();
            if (message.type === "menu") pauseGame();
            if (message.type === "haptic") navigator.vibrate?.(message.ms);
            if (message.type === "config") {
                setGameConfig(message.config);
                if (message.config.orientation !== "any" && document.fullscreenElement) {
                    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
                    orientation.lock?.(message.config.orientation).catch(() => undefined);
                }
            }
            if (message.type === "score" && pendingScore === null && !sheet) {
                setPaused(false);
                setPendingScore(message.score);
                setInitialsSlot(0);
                frameRef.current.blur();
                window.focus();
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [backToLibrary, pauseGame, pendingScore, sheet]);

    const createGame = useCallback(async () => {
        if (!token || creating) return;
        setCreating(true);
        try {
            await startBackgroundRun(token, { prompt: buildArcadeGamePrompt(recipe), uiLanguage: lang, generationMode: "auto" });
            setNotice(t("arcade.forgingStarted"));
            setView("library");
            setFocus(0);
            await loadLibrary(token);
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
        } finally {
            setCreating(false);
        }
    }, [token, creating, recipe, lang, t, loadLibrary]);

    const turnWheel = useCallback((row: number, delta: number) => {
        const wheel = ARCADE_WHEELS[row];
        if (!wheel) return;
        setRecipe((current) => {
            const options = wheel.options as readonly ArcadeOption[];
            const index = options.findIndex((option) => option.id === current[wheel.key]);
            const next = options[(index + delta + options.length) % options.length]!;
            return { ...current, [wheel.key]: next.id };
        });
    }, []);

    const sheetPrimary = useCallback(() => {
        if (!sheet) return;
        if (sheet.mode === "shelf") void openGame(sheet.project);
        else if (sheet.mode === "gameover") restartGame();
        else resumeGame();
    }, [sheet, openGame, restartGame, resumeGame]);

    const sheetClose = useCallback(() => {
        if (!sheet) return;
        if (sheet.mode === "gameover") backToLibrary();
        else setSheet(null);
    }, [sheet, backToLibrary]);

    // One input handler for keyboard and gamepad, per view.
    const handleAction = useCallback((action: ArcadeAction) => {
        if (sheet) {
            if (action === "a" || action === "start") sheetPrimary();
            if (action === "b" || action === "select") sheetClose();
            return;
        }
        if (view === "library") {
            if (action === "left") setFocus((f) => Math.max(0, f - 1));
            if (action === "right") setFocus((f) => Math.min(libraryItems - 1, f + 1));
            if (action === "up") setFocus((f) => (f < 2 ? f : f - 2 < columns ? 0 : f - columns));
            if (action === "down") setFocus((f) => (f < 2 ? Math.min(libraryItems - 1, 2) : Math.min(libraryItems - 1, f + columns)));
            if (action === "a" || action === "start") {
                if (focus === 0) { setView("new"); setNewFocus(0); }
                else if (focus === 1) { setPads(connectedPads()); setView("controls"); }
                else { const project = shelf[focus - 2]; if (project) void openGame(project); }
            }
            if (action === "x" || action === "y") { const project = shelf[focus - 2]; if (project) void showBoard(project, "shelf"); }
            if (action === "b" || action === "select") router.push("/dashboard");
            return;
        }
        if (view === "new") {
            const rows = ARCADE_WHEELS.length + 2; // wheels, random, create
            if (action === "up") setNewFocus((f) => Math.max(0, f - 1));
            if (action === "down") setNewFocus((f) => Math.min(rows - 1, f + 1));
            if (action === "left" && newFocus < ARCADE_WHEELS.length) turnWheel(newFocus, -1);
            if (action === "right" && newFocus < ARCADE_WHEELS.length) turnWheel(newFocus, 1);
            if (action === "a" || action === "start") {
                if (newFocus === ARCADE_WHEELS.length) setRecipe((current) => ({ ...randomArcadeRecipe(), extra: current.extra }));
                else if (newFocus === ARCADE_WHEELS.length + 1) void createGame();
                else turnWheel(newFocus, 1);
            }
            if (action === "y") setRecipe((current) => ({ ...randomArcadeRecipe(), extra: current.extra }));
            if (action === "b" || action === "select") setView("library");
            return;
        }
        if (view === "controls") {
            if ((action === "b" || action === "select") && !remap) setView("library");
            return;
        }
        if (view === "play") {
            if (pendingScore !== null) {
                if (action === "left") setInitialsSlot((s) => Math.max(0, s - 1));
                if (action === "right") setInitialsSlot((s) => Math.min(2, s + 1));
                if (action === "up") setInitials((current) => stepInitial(current, initialsSlot, 1));
                if (action === "down") setInitials((current) => stepInitial(current, initialsSlot, -1));
                if (action === "a" || action === "start") void submitScore();
                if (action === "b") skipScore();
                return;
            }
            if (paused) {
                if (action === "up") setPauseFocus((f) => Math.max(0, f - 1));
                if (action === "down") setPauseFocus((f) => Math.min(PAUSE_ITEMS.length - 1, f + 1));
                if (action === "a" || action === "start") choosePause(PAUSE_ITEMS[pauseFocus]!);
                if (action === "b" || action === "select") resumeGame();
            }
        }
    }, [sheet, sheetPrimary, sheetClose, view, libraryItems, columns, focus, shelf, openGame, showBoard, router, newFocus, turnWheel, createGame,
        remap, pendingScore, initialsSlot, submitScore, skipScore, paused, pauseFocus, choosePause, resumeGame]);

    // Gamepad: in a running game, forward to the frame (SELECT opens the pause menu); everywhere else, drive the menus.
    const inGame = view === "play" && pendingScore === null && !sheet && !paused;
    useArcadeGamepad({
        enabled: !remap,
        onPress: (action) => {
            if (inGame) {
                if (action === "select") pauseGame(); else sendKey(action, true);
                return;
            }
            handleAction(action);
        },
        onRelease: (action) => { if (inGame) sendKey(action, false); },
    });

    // Keyboard on the shell page (inside a running game, the frame has the focus and the keys).
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
                if (event.key === "Escape") target.blur();
                return;
            }
            // Backspace edits the initials; it must not skip the score (only Escape or B skips).
            if (view === "play" && pendingScore !== null && event.key === "Backspace") {
                event.preventDefault();
                setInitialsSlot((s) => Math.max(0, s - 1));
                return;
            }
            if (view === "play" && pendingScore !== null && /^[a-z0-9]$/i.test(event.key)) {
                event.preventDefault();
                const next = typeInitial(initials, initialsSlot, event.key);
                setInitials(next.initials);
                setInitialsSlot(next.slot);
                return;
            }
            const action = KEY_TO_ACTION[event.code];
            if (!action || inGame) return;
            event.preventDefault();
            handleAction(action);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [view, pendingScore, initials, initialsSlot, inGame, handleAction]);

    // Remapping: poll the chosen pad directly, one action at a time. Each step first waits until
    // the pad is at rest, so the button that confirmed the previous step is not read again.
    useEffect(() => {
        if (!remap) return;
        const padAt = () => connectedPads().find((pad) => pad.index === remap.padIndex) ?? null;
        const start = padAt();
        if (!start) { setRemap(null); return; }
        const rest = { buttons: start.buttons.map(() => ({ pressed: false, value: 0 })), axes: start.axes.map((value) => (Math.abs(value) > 0.5 ? value : 0)) };
        let frame = 0;
        let waitRelease = true;
        const tick = () => {
            const pad = padAt();
            if (!pad) { setRemap(null); return; }
            const state = { buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })), axes: [...pad.axes] };
            const binding = detectBinding(state, rest);
            if (waitRelease) {
                if (!binding) waitRelease = false;
            } else if (binding) {
                const action = ARCADE_ACTIONS[remap.step]!;
                const bindings = { ...remap.bindings, [action]: [binding] };
                if (remap.step + 1 >= ARCADE_ACTIONS.length) {
                    saveBindings(pad.id, bindings);
                    window.dispatchEvent(new Event("andy-arcade-bindings-changed"));
                    setRemap(null);
                    setPads(connectedPads());
                } else {
                    setRemap({ ...remap, step: remap.step + 1, bindings });
                }
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [remap]);

    useEffect(() => {
        if (view !== "controls") return;
        const refresh = () => setPads(connectedPads());
        window.addEventListener("gamepadconnected", refresh);
        window.addEventListener("gamepaddisconnected", refresh);
        const timer = window.setInterval(refresh, 1500);
        return () => {
            window.removeEventListener("gamepadconnected", refresh);
            window.removeEventListener("gamepaddisconnected", refresh);
            window.clearInterval(timer);
        };
    }, [view]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    useEffect(() => {
        if (!ready) return;
        const timer = window.setTimeout(() => setReady(null), 15000);
        return () => window.clearTimeout(timer);
    }, [ready]);

    // Leaving the page (browser back) must not leave the device in fullscreen.
    useEffect(() => () => { void leaveFullscreen(); }, []);

    // The phone's back button (or the browser's) goes back to the shelf from a game or a menu,
    // instead of leaving the Arcade: one history entry stands for "away from the shelf".
    const awayEntry = useRef(false);
    const goBackRef = useRef<() => void>(() => undefined);
    goBackRef.current = () => { if (view === "play") backToLibrary(); else { setSheet(null); setView("library"); } };
    useEffect(() => {
        if (view !== "library" && !awayEntry.current) {
            window.history.pushState({ andyArcade: "away" }, "");
            awayEntry.current = true;
        } else if (view === "library" && awayEntry.current) {
            awayEntry.current = false;
            window.history.back(); // consume our own entry; the popstate below ignores it
        }
    }, [view]);
    useEffect(() => {
        const onPop = () => {
            if (!awayEntry.current) return;
            awayEntry.current = false;
            goBackRef.current();
        };
        window.addEventListener("popstate", onPop);
        return () => window.removeEventListener("popstate", onPop);
    }, []);

    const now = Date.now();
    const readyProject = ready ? projects.find((project) => project.id === ready.projectId) : undefined;
    const needsRotation = view === "play" && touch && portrait && gameConfig?.orientation === "landscape" && !rotateDismissed && !paused && pendingScore === null && !sheet;
    const backButton = (
        <button type="button" onClick={() => setView("library")}
            className="mb-4 flex min-h-11 items-center gap-2 rounded-xl border-2 border-solid border-slate-600 bg-transparent px-4 text-base text-slate-200 active:scale-95">
            ◀ {t("arcade.library")}
        </button>
    );

    return (
        <div role="main" className="min-h-[100dvh] w-full overflow-x-hidden bg-[#07071a] bg-[radial-gradient(ellipse_at_top,rgba(76,29,149,0.35),transparent_60%)] font-mono text-slate-100 selection:bg-yellow-300 selection:text-black">
            {view !== "play" ? (
                <header className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
                    <h1 className="text-xl font-black tracking-widest text-yellow-300 drop-shadow-[0_0_12px_rgba(253,224,71,0.5)] sm:text-3xl">
                        🐱 ANDY ARCADE
                    </h1>
                    <div className="flex items-center gap-3">
                        <p className="hidden text-sm text-slate-400 lg:block">{t("arcade.hint")}</p>
                        <button type="button" onClick={() => router.push("/dashboard")} aria-label={t("arcade.dashboard")}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border-2 border-solid border-slate-600 bg-transparent text-xl text-slate-200 active:scale-95">⌂</button>
                    </div>
                </header>
            ) : null}

            {notice ? (
                <div className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-xl border-2 border-solid border-yellow-300 bg-black/90 px-4 py-3 text-center text-base sm:text-lg">{notice}</div>
            ) : null}

            {ready ? (
                <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-2xl border-2 border-solid border-cyan-400 bg-black/90 px-4 py-3 shadow-[0_0_30px_rgba(34,211,238,0.35)]">
                    <span className="flex-1 text-sm sm:text-base">✨ {t("arcade.gameReady", { name: ready.name })}</span>
                    {readyProject && view !== "play" ? (
                        <button type="button" onClick={() => { setReady(null); void openGame(readyProject); }}
                            className="min-h-10 rounded-lg border-0 bg-cyan-400 px-3 text-sm font-bold text-black">{t("arcade.playNow")}</button>
                    ) : null}
                    <button type="button" onClick={() => setReady(null)} aria-label={t("arcade.close")} className="h-10 w-10 rounded-lg border-0 bg-slate-800 text-slate-200">✕</button>
                </div>
            ) : null}

            {view === "library" ? (
                <section className="px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pt-6">
                    <div className="mb-5 grid grid-cols-2 gap-3 sm:flex sm:gap-4">
                        <button type="button" onClick={() => { setView("new"); setNewFocus(0); }}
                            className={`min-h-14 rounded-2xl border-4 border-solid px-4 text-lg font-bold active:scale-95 sm:px-6 sm:text-xl ${focus === 0 ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                            ＋ {t("arcade.newGame")}
                        </button>
                        <button type="button" onClick={() => { setPads(connectedPads()); setView("controls"); }}
                            className={`min-h-14 rounded-2xl border-4 border-solid px-4 text-lg font-bold active:scale-95 sm:px-6 sm:text-xl ${focus === 1 ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                            🎮 {t("arcade.controls")}
                        </button>
                    </div>

                    {forging.length ? (
                        <div className="mb-5 grid gap-3">
                            {forging.map((run) => {
                                const progress = computeBackgroundRunProgress(run, now);
                                return (
                                    <div key={run.id} className="rounded-xl border-2 border-dashed border-cyan-400 px-4 py-3">
                                        <div className="flex justify-between gap-2 text-sm text-cyan-300 sm:text-base"><span className="truncate">⚒ {t("arcade.forging")} {run.projectName ?? ""}</span><span>{Math.round(progress.percent)}%</span></div>
                                        <div className="mt-2 h-2 rounded bg-slate-800"><div className="h-2 rounded bg-cyan-400 transition-[width] duration-700" style={{ width: `${Math.round(progress.percent)}%` }} /></div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                    {failedRecently.map((run) => (
                        <p key={run.id} className="mb-2 text-sm text-red-400">✖ {t("arcade.forgeFailed")}: {run.error?.message ?? run.status}</p>
                    ))}

                    {loading ? <p className="text-xl">{t("arcade.loading")}</p> : null}
                    {error ? <p className="text-red-400">{error}</p> : null}
                    {!loading && !shelf.length ? <p className="text-lg text-slate-400 sm:text-xl">{t("arcade.empty")}</p> : null}

                    {shelf.length ? <p className="mb-3 text-xs uppercase tracking-widest text-slate-500">{touch ? t("arcade.shelfHintTouch") : t("arcade.shelfHint")}</p> : null}
                    <div className="grid gap-3 sm:gap-6" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {shelf.map((project, index) => (
                            <Cartridge key={project.id} project={project} focused={focus === index + 2} isNew={isNewGame(project, recentGames, now)}
                                best={best.get(project.id)} onPlay={() => void openGame(project)} onBoard={() => void showBoard(project, "shelf")} />
                        ))}
                    </div>
                </section>
            ) : null}

            {view === "new" ? (
                <section className="mx-auto max-w-3xl px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pt-8">
                    {backButton}
                    <h2 className="mb-4 text-xl font-bold text-cyan-300 sm:mb-6 sm:text-2xl">{t("arcade.newGameTitle")}</h2>
                    <div className="grid gap-3">
                        {ARCADE_WHEELS.map((wheel, row) => {
                            const options = wheel.options as readonly ArcadeOption[];
                            const current = options.find((option) => option.id === recipe[wheel.key]) ?? options[0]!;
                            return (
                                <WheelRow key={wheel.key} label={t(`arcade.wheel.${wheel.key}`)} value={label(current)} active={newFocus === row}
                                    onFocus={() => setNewFocus(row)} onTurn={(delta) => turnWheel(row, delta)} />
                            );
                        })}
                        <label className="grid gap-2 rounded-xl border-4 border-solid border-slate-700 px-3 py-3 sm:px-5">
                            <span className="text-sm text-slate-400 sm:text-base">{t("arcade.extra")}</span>
                            <textarea
                                value={recipe.extra}
                                maxLength={600}
                                rows={2}
                                onChange={(event) => setRecipe((current) => ({ ...current, extra: event.target.value }))}
                                className="rounded bg-slate-900 p-2 text-base text-white outline-none focus:ring-2 focus:ring-yellow-300 sm:text-lg"
                                placeholder={t("arcade.extraPlaceholder")}
                            />
                        </label>
                        <div className="flex gap-3 sm:gap-4">
                            <button type="button" onClick={() => setRecipe((current) => ({ ...randomArcadeRecipe(), extra: current.extra }))}
                                className={`min-h-14 flex-1 rounded-2xl border-4 border-solid px-4 text-lg font-bold active:scale-95 sm:text-xl ${newFocus === ARCADE_WHEELS.length ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                                🎲 {t("arcade.random")}
                            </button>
                            <button type="button" disabled={creating} onClick={() => void createGame()}
                                className={`min-h-14 flex-1 rounded-2xl border-4 border-solid px-4 text-lg font-bold active:scale-95 disabled:opacity-50 sm:text-xl ${newFocus === ARCADE_WHEELS.length + 1 ? "border-yellow-300 bg-yellow-300 text-black" : "border-cyan-400 bg-transparent text-cyan-300"}`}>
                                {creating ? "…" : `▶ ${t("arcade.create")}`}
                            </button>
                        </div>
                        <p className="text-sm text-slate-400">{t("arcade.createHint")}</p>
                    </div>
                </section>
            ) : null}

            {view === "controls" ? (
                <section className="mx-auto max-w-3xl px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pt-8">
                    {backButton}
                    <h2 className="mb-4 text-xl font-bold text-cyan-300 sm:text-2xl">{t("arcade.controlsTitle")}</h2>
                    {touch ? <p className="mb-4 rounded-xl border-2 border-solid border-cyan-700 bg-cyan-950/40 p-3 text-sm text-cyan-100 sm:text-base">📱 {t("arcade.touchControlsNote")}</p> : null}
                    <div className="mb-6 overflow-x-auto">
                        <table className="w-full min-w-[22rem] border-collapse text-left text-base sm:text-lg">
                            <thead className="text-slate-400"><tr><th className="py-1">{t("arcade.action")}</th><th>{t("arcade.keyboard")}</th><th>{t("arcade.gamepad")}</th></tr></thead>
                            <tbody>
                                {ARCADE_ACTIONS.map((action) => (
                                    <tr key={action} className="border-0 border-t border-solid border-slate-800">
                                        <td className="py-1 font-bold uppercase">{action}</td>
                                        <td>{KEYBOARD_LABEL[action]}</td>
                                        <td>{DEFAULT_BINDINGS[action].map(describeBinding).join(" · ")}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {!pads.length ? <p className="text-slate-400">{t("arcade.noPads")}</p> : null}
                    {pads.map((pad) => {
                        const bindings = loadBindings(pad.id);
                        const custom = bindings !== DEFAULT_BINDINGS;
                        return (
                            <div key={pad.index} className="mb-4 rounded-xl border-2 border-solid border-slate-700 p-4">
                                <p className="mb-2 truncate text-cyan-300">🎮 {pad.id} {pad.mapping === "standard" ? "" : `· ${t("arcade.nonStandard")}`}</p>
                                {remap?.padIndex === pad.index ? (
                                    <p className="text-2xl font-bold text-yellow-300">
                                        {t("arcade.pressFor")} <span className="uppercase">{ARCADE_ACTIONS[remap.step]}</span> ({remap.step + 1}/{ARCADE_ACTIONS.length})
                                    </p>
                                ) : (
                                    <div className="flex gap-3">
                                        <button type="button" className="min-h-11 rounded-lg border-2 border-solid border-yellow-300 bg-transparent px-4 text-slate-100" onClick={() => setRemap({ padIndex: pad.index, step: 0, bindings: { ...DEFAULT_BINDINGS } })}>
                                            {t("arcade.remap")}
                                        </button>
                                        {custom ? (
                                            <button type="button" className="min-h-11 rounded-lg border-2 border-solid border-slate-500 bg-transparent px-4 text-slate-100" onClick={() => { saveBindings(pad.id, null); window.dispatchEvent(new Event("andy-arcade-bindings-changed")); setPads(connectedPads()); }}>
                                                {t("arcade.resetMapping")}
                                            </button>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <p className="mt-4 text-sm text-slate-400">{t("arcade.controlsHint")}</p>
                </section>
            ) : null}

            {view === "play" && game ? (
                <section className="fixed inset-0 h-[100dvh] overflow-hidden overscroll-none bg-black">
                    {gameDoc ? (
                        <iframe
                            key={gameKey}
                            ref={frameRef}
                            title={game.name}
                            srcDoc={gameDoc}
                            sandbox="allow-scripts allow-pointer-lock"
                            allow="autoplay; fullscreen; gamepad"
                            className="h-full w-full border-0"
                            onLoad={() => frameRef.current?.focus()}
                        />
                    ) : (
                        <p className="flex h-full items-center justify-center text-2xl">{t("arcade.loading")}</p>
                    )}
                    {!paused && pendingScore === null && !sheet ? (
                        <button type="button" onClick={pauseGame} aria-label={t("arcade.paused")}
                            className="absolute left-[max(0.5rem,env(safe-area-inset-left))] top-[max(0.5rem,env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-solid border-white/30 bg-black/45 text-lg text-white opacity-70 backdrop-blur active:scale-90 [@media(hover:hover)]:opacity-30 [@media(hover:hover)]:hover:opacity-100">
                            ⏸
                        </button>
                    ) : null}

                    {needsRotation ? (
                        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 bg-black/90 px-8 text-center">
                            <p className="animate-pulse text-6xl">📱↻</p>
                            <p className="text-xl font-bold text-yellow-300">{t("arcade.rotate")}</p>
                            <button type="button" onClick={() => setRotateDismissed(true)}
                                className="min-h-11 rounded-xl border-2 border-solid border-slate-500 bg-transparent px-5 text-slate-200">{t("arcade.playAnyway")}</button>
                        </div>
                    ) : null}

                    {paused && !sheet ? (
                        <ArcadePauseMenu title={game.name} focus={pauseFocus} onChoose={choosePause}
                            hint={touch ? undefined : t("arcade.pauseHint")} />
                    ) : null}

                    {pendingScore !== null ? (
                        <ArcadeInitialsEntry
                            score={pendingScore}
                            initials={initials}
                            slot={initialsSlot}
                            recentPlayers={recentPlayers}
                            touch={touch}
                            saving={saving}
                            onChange={(next, slot) => { setInitials(next); setInitialsSlot(slot); }}
                            onSave={(name) => void submitScore(name)}
                            onSkip={skipScore}
                        />
                    ) : null}
                </section>
            ) : null}

            {sheet ? (
                <div className="fixed inset-0 z-40">
                    <ArcadeLeaderboardSheet
                        title={sheet.project.name}
                        entries={sheet.entries}
                        highlightId={sheet.highlightId}
                        rank={sheet.rank}
                        playLabel={sheet.mode === "shelf" ? `▶ ${t("arcade.play")}` : sheet.mode === "gameover" ? `↻ ${t("arcade.playAgain")}` : `▶ ${t("arcade.pause.resume")}`}
                        closeLabel={sheet.mode === "gameover" ? t("arcade.library") : undefined}
                        backdropCloses={sheet.mode !== "gameover"}
                        onPlay={sheetPrimary}
                        onClose={sheetClose}
                    />
                </div>
            ) : null}
        </div>
    );
}
