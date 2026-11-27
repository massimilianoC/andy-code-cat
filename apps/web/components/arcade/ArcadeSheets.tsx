"use client";

/**
 * Overlays of the Arcade shell: the leaderboard of one game (a bottom sheet on phones, a centred
 * panel on large screens) and the in-game pause menu. Both are driven by touch, mouse, keyboard
 * and gamepad: the page moves `focus` and calls `onChoose` for the gamepad and keyboard.
 */

import { useTranslation } from "react-i18next";
import type { LeaderboardEntryDto } from "@andy-code-cat/contracts";

const MEDALS = ["🥇", "🥈", "🥉"];

export function ArcadeLeaderboardSheet(props: {
    title: string;
    entries: LeaderboardEntryDto[] | null;
    highlightId?: string;
    rank?: number;
    playLabel: string;
    onPlay: () => void;
    onClose: () => void;
    closeLabel?: string;
}) {
    const { t } = useTranslation();
    const { title, entries, highlightId, rank, playLabel, onPlay, onClose, closeLabel } = props;
    return (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose} role="dialog" aria-modal="true" aria-label={t("arcade.leaderboard")}>
            <div onClick={(event) => event.stopPropagation()}
                className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl border-t-4 border-solid border-cyan-400 bg-[#0b0b24] px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_40px_rgba(34,211,238,0.25)] sm:max-w-md sm:rounded-3xl sm:border-4">
                <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-600 sm:hidden" />
                <p className="text-center text-sm uppercase tracking-widest text-slate-400">🏆 {t("arcade.leaderboard")}</p>
                <p className="mb-1 truncate text-center text-2xl font-black text-cyan-300">{title}</p>
                {rank ? <p className="mb-2 text-center text-xl font-bold text-yellow-300">{t("arcade.yourRank", { rank })}</p> : null}
                <ol className="my-3 text-xl">
                    {entries === null ? <li className="py-6 text-center text-slate-400">{t("arcade.loading")}</li> : null}
                    {entries && !entries.length ? <li className="py-6 text-center text-slate-400">{t("arcade.noScores")}</li> : null}
                    {entries?.map((entry, index) => (
                        <li key={entry.id}
                            className={`flex items-center justify-between gap-3 border-b border-solid border-slate-800 py-2 ${entry.id === highlightId ? "animate-pulse text-yellow-300" : ""}`}>
                            <span className="flex items-center gap-2">
                                <span className="w-8 text-center">{MEDALS[index] ?? String(index + 1).padStart(2, "0")}</span>
                                <span className="font-bold tracking-widest">{entry.player}</span>
                            </span>
                            <span className="tabular-nums">{entry.score.toLocaleString()}</span>
                        </li>
                    ))}
                </ol>
                <div className="flex gap-3">
                    <button type="button" onClick={onPlay}
                        className="min-h-12 flex-1 rounded-xl border-4 border-solid border-yellow-300 bg-yellow-300 px-4 text-lg font-bold text-black active:scale-95">
                        {playLabel}
                    </button>
                    <button type="button" onClick={onClose}
                        className="min-h-12 rounded-xl border-4 border-solid border-slate-600 bg-transparent px-4 text-lg text-slate-100 active:scale-95">
                        {closeLabel ?? t("arcade.close")}
                    </button>
                </div>
            </div>
        </div>
    );
}

export type PauseItem = "resume" | "restart" | "leaderboard" | "fullscreen" | "shelf";
export const PAUSE_ITEMS: PauseItem[] = ["resume", "restart", "leaderboard", "fullscreen", "shelf"];
const PAUSE_ICONS: Record<PauseItem, string> = { resume: "▶", restart: "↻", leaderboard: "🏆", fullscreen: "⛶", shelf: "◀" };

export function ArcadePauseMenu({ title, focus, onChoose, hint }: { title: string; focus: number; onChoose: (item: PauseItem) => void; hint?: string }) {
    const { t } = useTranslation();
    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 px-6" role="dialog" aria-modal="true" aria-label={t("arcade.paused")}>
            <div className="w-full max-w-xs">
                <p className="text-center text-3xl font-black tracking-widest text-yellow-300">⏸ {t("arcade.paused")}</p>
                <p className="mb-5 truncate text-center text-slate-400">{title}</p>
                <div className="grid gap-3">
                    {PAUSE_ITEMS.map((item, index) => (
                        <button key={item} type="button" onClick={() => onChoose(item)}
                            className={`flex min-h-12 items-center gap-3 rounded-xl border-4 border-solid px-5 text-left text-lg font-bold active:scale-95 ${index === focus ? "border-yellow-300 bg-yellow-300 text-black" : "border-slate-600 bg-slate-900/80 text-slate-100"}`}>
                            <span className="w-6 text-center">{PAUSE_ICONS[item]}</span>
                            {t(`arcade.pause.${item}`)}
                        </button>
                    ))}
                </div>
                {hint ? <p className="mt-4 text-center text-sm text-slate-500">{hint}</p> : null}
            </div>
        </div>
    );
}
