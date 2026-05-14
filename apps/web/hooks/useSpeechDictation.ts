"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import i18n from "@/lib/i18n";

// ── Web Speech API type shims ──────────────────────────────────────────────────
// These are not in standard TS lib.dom — we define them ourselves.

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };

type SpeechEvent = Event & {
    resultIndex: number;
    results: ArrayLike<SpeechResult>;
};

type SpeechErrorEvent = Event & { error?: string };

type SpeechRecognitionInstance = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: (() => void) | null;
    onend: (() => void) | null;
    onerror: ((e: SpeechErrorEvent) => void) | null;
    onresult: ((e: SpeechEvent) => void) | null;
    start: () => void;
    stop: () => void;
    abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

declare global {
    interface Window {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    }
}

// ── Language resolution ────────────────────────────────────────────────────────

/**
 * Maps the i18next language code (short, e.g. "it") to a BCP-47 tag accepted
 * by the Web Speech API (e.g. "it-IT").  Falls back to the browser's own
 * language preference when the app language is unknown.
 */
const LANG_TO_BCP47: Record<string, string> = {
    it: "it-IT",
    en: "en-US",
    fr: "fr-FR",
    de: "de-DE",
    es: "es-ES",
    pt: "pt-PT",
};

function resolveSpeechLang(): string {
    // Priority 1 — app-selected language (i18next, kept in sync with <html lang>)
    const appLang = i18n.language?.split("-")[0].toLowerCase();
    if (appLang && LANG_TO_BCP47[appLang]) return LANG_TO_BCP47[appLang];

    // Priority 2 — browser preferred language (already BCP-47 from navigator)
    const browserLang = navigator.languages?.[0] ?? navigator.language;
    if (browserLang) return browserLang;

    // Priority 3 — hard fallback
    return "it-IT";
}

// ── Text appending helper ─────────────────────────────────────────────────────

/**
 * Appends a recognised speech segment to the existing prompt text,
 * inserting a space separator when needed.
 */
function appendSegment(base: string, addition: string): string {
    const normalised = addition.trim();
    if (!normalised) return base;
    if (!base.trim()) return normalised;
    const needsSpace = !/[\s\n]$/.test(base);
    return `${base}${needsSpace ? " " : ""}${normalised}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface SpeechDictationState {
    /** Recognition is active and the mic is open. */
    listening: boolean;
    /** Browser supports the Web Speech API. */
    supported: boolean;
    /** Last error message, cleared on next start. */
    error: string | null;
    /** Toggle start / stop. Safe to call even when unsupported. */
    toggle: () => void;
    /** Clears the last error message. */
    clearError: () => void;
}

interface Messages {
    /** Shown when the browser does not support the API. */
    notSupported: string;
    /** Shown on generic mic / permission errors. */
    micError: string;
    /** Shown on recognition errors, receives `{error}` placeholder. */
    unavailable: (errorCode: string) => string;
}

/**
 * Reusable browser Speech-to-Text dictation hook.
 *
 * Language is resolved at toggle-time from the i18next active language,
 * then from the browser preference — matching the app's i18n priority chain.
 *
 * @param prompt      Current textarea value (read-only reference).
 * @param setPrompt   Setter for the textarea value.
 * @param messages    Translated error strings (caller provides via `t()`).
 */
export function useSpeechDictation(
    prompt: string,
    setPrompt: (v: string) => void,
    messages: Messages,
): SpeechDictationState {
    const [listening, setListening] = useState(false);
    const [supported, setSupported] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    // Base prompt at the moment the mic opens; committed transcripts are
    // appended to it rather than rebuilding from the live textarea on every
    // interim result.
    const basePromptRef = useRef("");
    const committedRef = useRef("");

    // Detect support after hydration (SSR-safe)
    useEffect(() => {
        if (typeof window !== "undefined") {
            setSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
        }
        return () => {
            recognitionRef.current?.abort();
            recognitionRef.current = null;
        };
    }, []);

    const toggle = useCallback(() => {
        // ── Stop ──────────────────────────────────────────────────────────────
        if (listening) {
            recognitionRef.current?.stop();
            return;
        }

        if (typeof window === "undefined") return;

        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor) {
            setSupported(false);
            setError(messages.notSupported);
            return;
        }

        // ── Start ─────────────────────────────────────────────────────────────
        const recognition: SpeechRecognitionInstance = recognitionRef.current ?? new Ctor();
        recognitionRef.current = recognition;

        recognition.continuous = true;
        recognition.interimResults = true;
        // Language resolved at call-time so it reflects the *current* selection
        recognition.lang = resolveSpeechLang();

        recognition.onstart = () => {
            // Capture base prompt so appended text is relative to this snapshot
            basePromptRef.current = prompt;
            committedRef.current = "";
            setListening(true);
            setError(null);
        };

        recognition.onresult = (event: SpeechEvent) => {
            // Accumulate only FINAL results — interim results would cause
            // flickering as the textarea is rewritten on every word boundary.
            let finalChunk = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i]?.isFinal) {
                    finalChunk += event.results[i]?.[0]?.transcript ?? "";
                }
            }
            if (finalChunk) {
                committedRef.current = appendSegment(committedRef.current, finalChunk);
                setPrompt(appendSegment(basePromptRef.current, committedRef.current));
            }
        };

        recognition.onerror = (event: SpeechErrorEvent) => {
            const code = event.error ?? "unknown";
            // "aborted" and "no-speech" are benign — don't show an error toast
            if (code !== "aborted" && code !== "no-speech") {
                setError(
                    code === "not-allowed" || code === "service-not-allowed"
                        ? messages.micError
                        : messages.unavailable(code),
                );
            }
            setListening(false);
        };

        recognition.onend = () => {
            setListening(false);
        };

        try {
            recognition.start();
        } catch {
            setError(messages.micError);
            setListening(false);
        }
    }, [listening, prompt, setPrompt, messages]);

    const clearError = useCallback(() => setError(null), []);

    return { listening, supported, error, toggle, clearError };
}
