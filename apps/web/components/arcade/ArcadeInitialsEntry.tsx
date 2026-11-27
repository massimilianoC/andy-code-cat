"use client";

/**
 * Game-over name entry of the Arcade (docs/specs/ARCADE_MODE_MVP.md §5), usable with a thumb, a
 * keyboard or a gamepad:
 * - recent players on this device, one tap away;
 * - three letter wheels: drag a letter up or down, or tap ▲ / ▼;
 * - a simplified keypad (A–Z, 0–9, delete) for touch screens;
 * - typing on a keyboard and the gamepad (handled by the page) write into the same slots.
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { INITIALS_ALPHABET, INITIALS_LENGTH, stepInitial, typeInitial } from "@/lib/arcade/shelf";

const WHEEL_STEP_PX = 26;

function LetterWheel({ char, active, onFocus, onStep }: { char: string; active: boolean; onFocus: () => void; onStep: (delta: number) => void }) {
    const drag = useRef<{ pointerId: number; y: number } | null>(null);
    const index = INITIALS_ALPHABET.indexOf(char);
    const neighbour = (delta: number) => INITIALS_ALPHABET[(index + delta + INITIALS_ALPHABET.length) % INITIALS_ALPHABET.length];

    return (
        <div className="flex flex-col items-center gap-1">
            <button type="button" aria-label="▲" onClick={() => { onFocus(); onStep(1); }}
                className="h-11 w-16 rounded-lg border-0 bg-slate-800/80 text-xl text-cyan-300 active:scale-95">▲</button>
            <div
                role="spinbutton"
                aria-valuetext={char}
                tabIndex={-1}
                onPointerDown={(event) => {
                    onFocus();
                    drag.current = { pointerId: event.pointerId, y: event.clientY };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const current = drag.current;
                    if (!current || current.pointerId !== event.pointerId) return;
                    const steps = Math.trunc((current.y - event.clientY) / WHEEL_STEP_PX);
                    if (steps !== 0) {
                        onStep(steps);
                        current.y -= steps * WHEEL_STEP_PX;
                    }
                }}
                onPointerUp={() => { drag.current = null; }}
                onPointerCancel={() => { drag.current = null; }}
                className={`relative flex h-28 w-16 touch-none select-none flex-col items-center justify-center overflow-hidden rounded-xl border-4 border-solid sm:w-20 ${active ? "border-yellow-300 shadow-[0_0_24px_rgba(253,224,71,0.45)]" : "border-slate-600"}`}
            >
                <span className="text-base font-bold text-slate-600">{neighbour(1)}</span>
                <span className={`text-5xl font-black leading-none ${active ? "text-yellow-300" : "text-slate-100"}`}>{char}</span>
                <span className="text-base font-bold text-slate-600">{neighbour(-1)}</span>
            </div>
            <button type="button" aria-label="▼" onClick={() => { onFocus(); onStep(-1); }}
                className="h-11 w-16 rounded-lg border-0 bg-slate-800/80 text-xl text-cyan-300 active:scale-95">▼</button>
        </div>
    );
}

export function ArcadeInitialsEntry(props: {
    score: number;
    initials: string;
    slot: number;
    recentPlayers: string[];
    touch: boolean;
    saving: boolean;
    onChange: (initials: string, slot: number) => void;
    onSave: (initials?: string) => void;
    onSkip: () => void;
}) {
    const { t } = useTranslation();
    const { score, initials, slot, recentPlayers, touch, saving, onChange, onSave, onSkip } = props;
    const chars = initials.padEnd(INITIALS_LENGTH, "A").slice(0, INITIALS_LENGTH).split("");

    return (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-black/90 px-4 py-6">
            <p className="text-2xl font-black tracking-widest text-yellow-300 sm:text-3xl">{t("arcade.gameOver")}</p>
            <p className="text-4xl font-black tabular-nums sm:text-5xl">{score.toLocaleString()}</p>

            {recentPlayers.length ? (
                <div className="flex max-w-full flex-wrap justify-center gap-2">
                    {recentPlayers.map((name) => (
                        <button key={name} type="button" disabled={saving} onClick={() => onSave(name)}
                            className="min-h-11 rounded-full border-2 border-solid border-cyan-400 bg-cyan-400/10 px-4 text-lg font-bold text-cyan-200 active:scale-95">
                            ▶ {name}
                        </button>
                    ))}
                </div>
            ) : null}

            <p className="text-base text-slate-300">{t("arcade.enterInitials")}</p>
            <div className="flex gap-3">
                {chars.map((char, index) => (
                    <LetterWheel key={index} char={char} active={index === slot}
                        onFocus={() => onChange(initials, index)}
                        onStep={(delta) => onChange(stepInitial(initials, index, delta), index)} />
                ))}
            </div>

            {touch ? (
                <div className="grid w-full max-w-sm grid-cols-9 gap-1" aria-label={t("arcade.keypad")}>
                    {INITIALS_ALPHABET.split("").map((char) => (
                        <button key={char} type="button" onClick={() => { const next = typeInitial(initials, slot, char); onChange(next.initials, next.slot); }}
                            className="h-10 rounded-md border-0 bg-slate-800 text-lg font-bold text-slate-100 active:bg-yellow-300 active:text-black">
                            {char}
                        </button>
                    ))}
                    <button type="button" aria-label={t("arcade.deleteLetter")} onClick={() => onChange(initials, Math.max(0, slot - 1))}
                        className="col-span-9 h-10 rounded-md border-0 bg-slate-700 text-lg text-slate-100 active:bg-slate-500">⌫ {t("arcade.deleteLetter")}</button>
                </div>
            ) : null}

            <div className="flex w-full max-w-sm gap-3">
                <button type="button" disabled={saving} onClick={() => onSave()}
                    className="min-h-12 flex-1 rounded-xl border-4 border-solid border-yellow-300 bg-yellow-300 px-4 text-lg font-bold text-black disabled:opacity-60">
                    {saving ? "…" : t("arcade.saveScore")}
                </button>
                <button type="button" onClick={onSkip}
                    className="min-h-12 rounded-xl border-4 border-solid border-slate-600 bg-transparent px-4 text-lg text-slate-100">
                    {t("arcade.skip")}
                </button>
            </div>
        </div>
    );
}
