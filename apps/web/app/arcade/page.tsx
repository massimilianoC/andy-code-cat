"use client";

/**
 * Andy Arcade (docs/specs/ARCADE_MODE_MVP.md): the same platform, seen as a game console.
 *
 * A mode is a shell over the shared core, not a fork: it lists only the projects made with the
 * game presets, plays their active version in a sandboxed frame with the Arcade runtime, keeps
 * per-game leaderboards through the platform capability, and creates new games through the normal
 * background Vibe run. Everything is reachable with a keyboard or a gamepad.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { BACKGROUND_RUN_TERMINAL_STATUSES, computeBackgroundRunProgress, type BackgroundRunDto, type LeaderboardEntryDto } from "@andy-code-cat/contracts";
import { getToken } from "@/lib/token-store";
import { listProjects, type Project } from "@/lib/api/projects";
import { listBackgroundRuns, startBackgroundRun } from "@/lib/api/backgroundRuns";
import { getLeaderboard, getPreviewSnapshot, submitLeaderboardScore } from "@/lib/api/arcade";
import { buildPreviewDoc } from "@/lib/preview/buildPreviewDoc";
import { fetchThumbnailBlobUrl } from "@/components/ProjectCard";
import { ARCADE_SHELL_SOURCE, injectArcadeRuntime, parseArcadeGameMessage } from "@/lib/arcade/arcadeRuntime";
import {
    ACTION_KEY, ARCADE_ACTIONS, DEFAULT_BINDINGS, connectedPads, describeBinding, detectBinding, loadBindings, saveBindings,
    useArcadeGamepad, type ArcadeAction, type GamepadBindings,
} from "@/lib/arcade/gamepad";
import {
    ARCADE_PROMPT_PREFIX, ARCADE_WHEELS, buildArcadeGamePrompt, isArcadeProject, randomArcadeRecipe, type ArcadeOption, type ArcadeRecipe,
} from "@/lib/arcade/arcadeRecipe";

type View = "library" | "play" | "new" | "controls";

const KEY_TO_ACTION: Record<string, ArcadeAction> = {
    ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    Enter: "start", Space: "a", Escape: "b", Backspace: "b",
};
const KEYBOARD_LABEL: Record<ArcadeAction, string> = {
    up: "W / ↑", down: "S / ↓", left: "A / ←", right: "D / →", a: "Space", b: "Shift", x: "K", y: "P", start: "Enter", select: "Esc Esc",
};
const INITIALS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const PLAYER_STORAGE_KEY = "andy-arcade:player";

function readPlayer(): string {
    try { return (window.localStorage.getItem(PLAYER_STORAGE_KEY) ?? "AAA").slice(0, 3).toUpperCase().padEnd(3, "A"); } catch { return "AAA"; }
}

function writePlayer(name: string) {
    try { window.localStorage.setItem(PLAYER_STORAGE_KEY, name); } catch { /* per-session only */ }
}

function isTerminal(run: BackgroundRunDto) {
    return (BACKGROUND_RUN_TERMINAL_STATUSES as readonly string[]).includes(run.status);
}

/** Library tile: thumbnail of the active version, or a generated cartridge face. */
function Cartridge({ project, focused, onSelect }: { project: Project; focused: boolean; onSelect: () => void }) {
    const [thumb, setThumb] = useState<string | null>(null);
    const ref = useRef<HTMLButtonElement>(null);

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

    const hue = (project.id.charCodeAt(0) * 37 + project.id.charCodeAt(project.id.length - 1) * 11) % 360;
    return (
        <button
            ref={ref}
            type="button"
            onClick={onSelect}
            className={`group relative aspect-[4/3] overflow-hidden rounded-xl border-4 border-solid text-left transition-transform ${focused ? "scale-105 border-yellow-300 shadow-[0_0_32px_rgba(253,224,71,0.6)]" : "border-slate-700"}`}
            style={{ background: `linear-gradient(135deg, hsl(${hue} 70% 25%), hsl(${(hue + 60) % 360} 70% 12%))` }}
        >
            {thumb ? <img src={thumb} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90" /> : null}
            <span className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 font-mono text-lg font-bold uppercase tracking-wide text-white">
                {project.name}
            </span>
        </button>
    );
}

export default function ArcadePage() {
    const router = useRouter();
    const { t, i18n } = useTranslation();
    const [token, setToken] = useState<string | null>(null);
    const [view, setView] = useState<View>("library");
    const [projects, setProjects] = useState<Project[]>([]);
    const [runs, setRuns] = useState<BackgroundRunDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [focus, setFocus] = useState(0);
    const [columns, setColumns] = useState(4);

    // Play
    const [game, setGame] = useState<Project | null>(null);
    const [gameDoc, setGameDoc] = useState<string | null>(null);
    const [gameKey, setGameKey] = useState(0);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [pendingScore, setPendingScore] = useState<number | null>(null);
    const [initials, setInitials] = useState("AAA");
    const [initialsSlot, setInitialsSlot] = useState(0);
    const [board, setBoard] = useState<{ entries: LeaderboardEntryDto[]; highlightId?: string; rank?: number } | null>(null);

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
        setInitials(readPlayer());
    }, [router]);

    useEffect(() => {
        const update = () => setColumns(window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : 2);
        update();
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);

    const loadLibrary = useCallback(async (tok: string) => {
        try {
            const [{ projects: all }, { runs: recent }] = await Promise.all([listProjects(tok), listBackgroundRuns(tok, 20)]);
            setProjects(all.filter(isArcadeProject).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
            setRuns(recent.filter((run) => run.prompt.startsWith(ARCADE_PROMPT_PREFIX)));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { if (token) void loadLibrary(token); }, [token, loadLibrary]);

    const forging = useMemo(() => runs.filter((run) => !isTerminal(run)), [runs]);
    const failedRecently = useMemo(() => runs.filter((run) => run.status === "failed").slice(0, 2), [runs]);

    // While a game is being made, refresh the shelf until it lands.
    useEffect(() => {
        if (!token || !forging.length) return;
        const timer = window.setInterval(() => void loadLibrary(token), 8000);
        return () => window.clearInterval(timer);
    }, [token, forging.length, loadLibrary]);

    // Library focus: 0 = new game, 1 = controls, 2.. = games.
    const libraryItems = 2 + projects.length;

    const openGame = useCallback(async (project: Project) => {
        if (!token) return;
        if (!project.activeSnapshotId) { setNotice(t("arcade.noVersion")); return; }
        setGame(project);
        setGameDoc(null);
        setBoard(null);
        setPendingScore(null);
        setView("play");
        try {
            const { snapshot } = await getPreviewSnapshot(token, project.id, project.activeSnapshotId);
            const { doc } = buildPreviewDoc(snapshot.artifacts.html, snapshot.artifacts.css, snapshot.artifacts.js);
            setGameDoc(injectArcadeRuntime(doc));
            setGameKey((key) => key + 1);
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
            setView("library");
        }
    }, [token, t]);

    const backToLibrary = useCallback(() => {
        setView("library");
        setGame(null);
        setGameDoc(null);
        setPendingScore(null);
        setBoard(null);
        if (token) void loadLibrary(token);
    }, [token, loadLibrary]);

    const restartGame = useCallback(() => {
        setPendingScore(null);
        setBoard(null);
        setGameKey((key) => key + 1);
    }, []);

    const sendKey = useCallback((action: ArcadeAction, down: boolean) => {
        const code = ACTION_KEY[action];
        if (!code) return;
        frameRef.current?.contentWindow?.postMessage({ source: ARCADE_SHELL_SOURCE, type: "key", code, down }, "*");
    }, []);

    const submitScore = useCallback(async () => {
        if (!token || !game || pendingScore === null) return;
        const player = initials.trim() || "AAA";
        writePlayer(player);
        try {
            const result = await submitLeaderboardScore(token, game.id, { player, score: pendingScore });
            setBoard({ entries: result.top, highlightId: result.entry.id, rank: result.rank });
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
            const { entries } = await getLeaderboard(token, game.id).catch(() => ({ entries: [] as LeaderboardEntryDto[] }));
            setBoard({ entries });
        }
        setPendingScore(null);
    }, [token, game, pendingScore, initials]);

    // Messages from the game frame: only from our own frame, only well-formed.
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
            const message = parseArcadeGameMessage(event.data);
            if (!message) return;
            if (message.type === "ready") frameRef.current.focus();
            if (message.type === "exit") backToLibrary();
            if (message.type === "score" && pendingScore === null && !board) {
                setPendingScore(message.score);
                setInitialsSlot(0);
                (document.activeElement as HTMLElement | null)?.blur();
                window.focus();
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [backToLibrary, pendingScore, board]);

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
            const options = wheel.options;
            const index = options.findIndex((option) => option.id === current[wheel.key]);
            const next = options[(index + delta + options.length) % options.length]!;
            return { ...current, [wheel.key]: next.id };
        });
    }, []);

    // One input handler for keyboard and gamepad, per view.
    const handleAction = useCallback((action: ArcadeAction) => {
        if (view === "library") {
            if (action === "left") setFocus((f) => Math.max(0, f - 1));
            if (action === "right") setFocus((f) => Math.min(libraryItems - 1, f + 1));
            if (action === "up") setFocus((f) => (f < 2 ? f : f - 2 < columns ? 0 : f - columns));
            if (action === "down") setFocus((f) => (f < 2 ? Math.min(libraryItems - 1, 2) : Math.min(libraryItems - 1, f + columns)));
            if (action === "a" || action === "start") {
                if (focus === 0) { setView("new"); setNewFocus(0); }
                else if (focus === 1) { setPads(connectedPads()); setView("controls"); }
                else { const project = projects[focus - 2]; if (project) void openGame(project); }
            }
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
                if (action === "up" || action === "down") {
                    setInitials((current) => {
                        const chars = current.padEnd(3, "A").split("");
                        const index = INITIALS_ALPHABET.indexOf(chars[initialsSlot] ?? "A");
                        const step = action === "up" ? 1 : -1;
                        chars[initialsSlot] = INITIALS_ALPHABET[(index + step + INITIALS_ALPHABET.length) % INITIALS_ALPHABET.length]!;
                        return chars.join("");
                    });
                }
                if (action === "a" || action === "start") void submitScore();
                if (action === "b") { setPendingScore(null); void getLeaderboard(token!, game!.id).then(({ entries }) => setBoard({ entries })).catch(() => undefined); }
                return;
            }
            if (board) {
                if (action === "a" || action === "start") restartGame();
                if (action === "b" || action === "select") backToLibrary();
            }
        }
    }, [view, libraryItems, columns, focus, projects, openGame, router, newFocus, turnWheel, createGame, remap, pendingScore, initialsSlot, submitScore, token, game, board, restartGame, backToLibrary]);

    // Gamepad: in a running game, forward to the frame; everywhere else, drive the menus.
    const inGame = view === "play" && pendingScore === null && !board;
    useArcadeGamepad({
        enabled: !remap,
        onPress: (action) => {
            if (inGame) {
                if (action === "select") backToLibrary(); else sendKey(action, true);
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
            if (view === "play" && pendingScore !== null && /^[a-z0-9]$/i.test(event.key)) {
                event.preventDefault();
                setInitials((current) => {
                    const chars = current.padEnd(3, "A").split("");
                    chars[initialsSlot] = event.key.toUpperCase();
                    return chars.join("");
                });
                setInitialsSlot((s) => Math.min(2, s + 1));
                return;
            }
            const action = KEY_TO_ACTION[event.code];
            if (!action || inGame) return;
            event.preventDefault();
            handleAction(action);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [view, pendingScore, initialsSlot, inGame, handleAction]);

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

    const now = Date.now();

    return (
        <div role="main" className="min-h-screen w-full bg-[#07071a] font-mono text-slate-100 selection:bg-yellow-300 selection:text-black">
            {view !== "play" ? (
                <header className="flex items-center justify-between px-8 pt-6">
                    <h1 className="text-3xl font-black tracking-widest text-yellow-300 drop-shadow-[0_0_12px_rgba(253,224,71,0.5)]">
                        🐱 ANDY ARCADE
                    </h1>
                    <p className="text-sm text-slate-400">{t("arcade.hint")}</p>
                </header>
            ) : null}

            {notice ? (
                <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg border-2 border-solid border-yellow-300 bg-black/90 px-5 py-3 text-lg">{notice}</div>
            ) : null}

            {view === "library" ? (
                <section className="px-8 pb-12 pt-6">
                    <div className="mb-6 flex gap-4">
                        <button type="button" onClick={() => { setView("new"); setNewFocus(0); }}
                            className={`rounded-xl border-4 border-solid px-6 py-4 text-xl font-bold ${focus === 0 ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                            ＋ {t("arcade.newGame")}
                        </button>
                        <button type="button" onClick={() => { setPads(connectedPads()); setView("controls"); }}
                            className={`rounded-xl border-4 border-solid px-6 py-4 text-xl font-bold ${focus === 1 ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                            🎮 {t("arcade.controls")}
                        </button>
                    </div>

                    {forging.length ? (
                        <div className="mb-6 grid gap-3">
                            {forging.map((run) => {
                                const progress = computeBackgroundRunProgress(run, now);
                                return (
                                    <div key={run.id} className="rounded-lg border-2 border-dashed border-cyan-400 px-4 py-3">
                                        <div className="flex justify-between text-cyan-300"><span>⚒ {t("arcade.forging")} {run.projectName ?? ""}</span><span>{Math.round(progress.percent)}%</span></div>
                                        <div className="mt-2 h-2 rounded bg-slate-800"><div className="h-2 rounded bg-cyan-400" style={{ width: `${Math.round(progress.percent)}%` }} /></div>
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
                    {!loading && !projects.length ? <p className="text-xl text-slate-400">{t("arcade.empty")}</p> : null}

                    <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                        {projects.map((project, index) => (
                            <Cartridge key={project.id} project={project} focused={focus === index + 2} onSelect={() => void openGame(project)} />
                        ))}
                    </div>
                </section>
            ) : null}

            {view === "new" ? (
                <section className="mx-auto max-w-3xl px-8 pb-12 pt-8">
                    <h2 className="mb-6 text-2xl font-bold text-cyan-300">{t("arcade.newGameTitle")}</h2>
                    <div className="grid gap-3">
                        {ARCADE_WHEELS.map((wheel, row) => {
                            const current = wheel.options.find((option) => option.id === recipe[wheel.key]) ?? wheel.options[0]!;
                            const active = newFocus === row;
                            return (
                                <div key={wheel.key} onClick={() => setNewFocus(row)}
                                    className={`flex items-center justify-between rounded-lg border-4 border-solid px-5 py-3 text-xl ${active ? "border-yellow-300" : "border-slate-700"}`}>
                                    <span className="text-slate-400">{t(`arcade.wheel.${wheel.key}`)}</span>
                                    <span className="flex items-center gap-4">
                                        <button type="button" className="bg-transparent px-2 text-2xl text-cyan-300" onClick={() => turnWheel(row, -1)} aria-label="previous">◀</button>
                                        <span className="min-w-[12rem] text-center font-bold">{label(current)}</span>
                                        <button type="button" className="bg-transparent px-2 text-2xl text-cyan-300" onClick={() => turnWheel(row, 1)} aria-label="next">▶</button>
                                    </span>
                                </div>
                            );
                        })}
                        <label className="grid gap-2 rounded-lg border-4 border-solid border-slate-700 px-5 py-3">
                            <span className="text-slate-400">{t("arcade.extra")}</span>
                            <textarea
                                value={recipe.extra}
                                maxLength={600}
                                rows={2}
                                onChange={(event) => setRecipe((current) => ({ ...current, extra: event.target.value }))}
                                className="rounded bg-slate-900 p-2 text-lg text-white outline-none focus:ring-2 focus:ring-yellow-300"
                                placeholder={t("arcade.extraPlaceholder")}
                            />
                        </label>
                        <div className="flex gap-4">
                            <button type="button" onClick={() => setRecipe((current) => ({ ...randomArcadeRecipe(), extra: current.extra }))}
                                className={`flex-1 rounded-xl border-4 border-solid px-6 py-4 text-xl font-bold ${newFocus === ARCADE_WHEELS.length ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-transparent text-slate-100"}`}>
                                🎲 {t("arcade.random")}
                            </button>
                            <button type="button" disabled={creating} onClick={() => void createGame()}
                                className={`flex-1 rounded-xl border-4 border-solid px-6 py-4 text-xl font-bold disabled:opacity-50 ${newFocus === ARCADE_WHEELS.length + 1 ? "border-yellow-300 bg-yellow-300 text-black" : "border-cyan-400 bg-transparent text-cyan-300"}`}>
                                {creating ? "…" : `▶ ${t("arcade.create")}`}
                            </button>
                        </div>
                        <p className="text-sm text-slate-400">{t("arcade.createHint")}</p>
                    </div>
                </section>
            ) : null}

            {view === "controls" ? (
                <section className="mx-auto max-w-3xl px-8 pb-12 pt-8">
                    <h2 className="mb-4 text-2xl font-bold text-cyan-300">{t("arcade.controlsTitle")}</h2>
                    <table className="mb-6 w-full text-left text-lg">
                        <thead className="text-slate-400"><tr><th className="py-1">{t("arcade.action")}</th><th>{t("arcade.keyboard")}</th><th>{t("arcade.gamepad")}</th></tr></thead>
                        <tbody>
                            {ARCADE_ACTIONS.map((action) => (
                                <tr key={action} className="border-t border-slate-800">
                                    <td className="py-1 font-bold uppercase">{action}</td>
                                    <td>{KEYBOARD_LABEL[action]}</td>
                                    <td>{DEFAULT_BINDINGS[action].map(describeBinding).join(" · ")}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!pads.length ? <p className="text-slate-400">{t("arcade.noPads")}</p> : null}
                    {pads.map((pad) => {
                        const bindings = loadBindings(pad.id);
                        const custom = bindings !== DEFAULT_BINDINGS;
                        return (
                            <div key={pad.index} className="mb-4 rounded-lg border-2 border-solid border-slate-700 p-4">
                                <p className="mb-2 truncate text-cyan-300">🎮 {pad.id} {pad.mapping === "standard" ? "" : `· ${t("arcade.nonStandard")}`}</p>
                                {remap?.padIndex === pad.index ? (
                                    <p className="text-2xl font-bold text-yellow-300">
                                        {t("arcade.pressFor")} <span className="uppercase">{ARCADE_ACTIONS[remap.step]}</span> ({remap.step + 1}/{ARCADE_ACTIONS.length})
                                    </p>
                                ) : (
                                    <div className="flex gap-3">
                                        <button type="button" className="rounded border-2 border-solid border-yellow-300 bg-transparent px-4 py-2 text-slate-100" onClick={() => setRemap({ padIndex: pad.index, step: 0, bindings: { ...DEFAULT_BINDINGS } })}>
                                            {t("arcade.remap")}
                                        </button>
                                        {custom ? (
                                            <button type="button" className="rounded border-2 border-solid border-slate-500 bg-transparent px-4 py-2 text-slate-100" onClick={() => { saveBindings(pad.id, null); window.dispatchEvent(new Event("andy-arcade-bindings-changed")); setPads(connectedPads()); }}>
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
                <section className="fixed inset-0 bg-black">
                    {gameDoc ? (
                        <iframe
                            key={gameKey}
                            ref={frameRef}
                            title={game.name}
                            srcDoc={gameDoc}
                            sandbox="allow-scripts allow-pointer-lock"
                            allow="autoplay; fullscreen"
                            className="h-full w-full border-0"
                            onLoad={() => frameRef.current?.focus()}
                        />
                    ) : (
                        <p className="flex h-full items-center justify-center text-2xl">{t("arcade.loading")}</p>
                    )}
                    <button type="button" onClick={backToLibrary} className="absolute left-3 top-3 rounded bg-black/60 px-3 py-1 text-sm text-slate-300 opacity-40 hover:opacity-100">
                        ◀ {t("arcade.backHint")}
                    </button>

                    {pendingScore !== null ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-black/85">
                            <p className="text-3xl font-black text-yellow-300">{t("arcade.gameOver")}</p>
                            <p className="text-5xl font-black">{pendingScore.toLocaleString()}</p>
                            <p className="text-lg text-slate-300">{t("arcade.enterInitials")}</p>
                            <div className="flex gap-4">
                                {initials.padEnd(3, "A").split("").map((char, index) => (
                                    <button key={index} type="button" onClick={() => setInitialsSlot(index)}
                                        className={`w-20 rounded-lg border-4 border-solid py-3 text-5xl font-black ${index === initialsSlot ? "border-yellow-300 text-yellow-300" : "border-slate-600 bg-transparent text-slate-100"}`}>
                                        {char}
                                    </button>
                                ))}
                            </div>
                            <div className="flex gap-4">
                                <button type="button" onClick={() => void submitScore()} className="rounded-xl border-4 border-solid border-yellow-300 bg-yellow-300 px-6 py-3 text-xl font-bold text-black">{t("arcade.saveScore")}</button>
                                <button type="button" onClick={() => { setPendingScore(null); if (token && game) void getLeaderboard(token, game.id).then(({ entries }) => setBoard({ entries })).catch(() => undefined); }}
                                    className="rounded-xl border-4 border-solid border-slate-600 bg-transparent px-6 py-3 text-xl text-slate-100">{t("arcade.skip")}</button>
                            </div>
                        </div>
                    ) : null}

                    {board ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85">
                            <p className="text-3xl font-black text-cyan-300">🏆 {t("arcade.leaderboard")}</p>
                            {board.rank ? <p className="text-xl text-yellow-300">{t("arcade.yourRank", { rank: board.rank })}</p> : null}
                            <ol className="w-full max-w-md text-2xl">
                                {board.entries.length ? board.entries.map((entry, index) => (
                                    <li key={entry.id} className={`flex justify-between border-b border-slate-800 py-1 ${entry.id === board.highlightId ? "text-yellow-300" : ""}`}>
                                        <span>{String(index + 1).padStart(2, "0")}. {entry.player}</span>
                                        <span>{entry.score.toLocaleString()}</span>
                                    </li>
                                )) : <li className="text-center text-slate-400">{t("arcade.noScores")}</li>}
                            </ol>
                            <div className="flex gap-4">
                                <button type="button" onClick={restartGame} className="rounded-xl border-4 border-solid border-yellow-300 bg-yellow-300 px-6 py-3 text-xl font-bold text-black">↻ {t("arcade.playAgain")}</button>
                                <button type="button" onClick={backToLibrary} className="rounded-xl border-4 border-solid border-slate-600 bg-transparent px-6 py-3 text-xl text-slate-100">{t("arcade.library")}</button>
                            </div>
                        </div>
                    ) : null}
                </section>
            ) : null}
        </div>
    );
}
