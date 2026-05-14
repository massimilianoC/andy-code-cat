"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, ArrowRight, X, ChevronDown, Loader2, Upload, Mic, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import { cn } from "@/lib/utils";
import { ModeSelector, type VibeMode } from "./ModeSelector";
import { VibeCoreBackground } from "./VibeCoreBackground";
import { ScrollBlurOverlay } from "./ScrollBlurOverlay";
import { classifyVibeIntent } from "@/lib/api/vibecore";
import { createProject, uploadProjectAsset } from "@/lib/api";

/** Max file size accepted via the VibeCore drag-and-drop zone (10 MB). */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 3;
const ACCEPTED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/svg+xml",
];

type EntryPhase = "idle" | "classifying" | "creating" | "uploading" | "redirecting";

/** i18n keys for phase labels — translated at render time. */
const PHASE_LABEL_KEYS: Record<EntryPhase, string> = {
    idle:        "",
    classifying: "vibecore.phase.classifying",
    creating:    "vibecore.phase.creating",
    uploading:   "vibecore.phase.uploading",
    redirecting: "vibecore.phase.redirecting",
};

interface FilePill {
    file: File;
    id: string;
}

function loadMode(): VibeMode {
    try {
        const saved = localStorage.getItem(VIBE_MODE_KEY);
        if (saved === "easy" || saved === "medium" || saved === "hard") return saved;
    } catch {
        // ignore
    }
    return "easy";
}

function saveMode(mode: VibeMode) {
    try {
        localStorage.setItem(VIBE_MODE_KEY, mode);
    } catch {
        // ignore
    }
}

const MODE_GLOW: Record<VibeMode, string> = {
    easy:   "#8b5cf6",
    medium: "#3b82f6",
    hard:   "#10b981",
};

interface VibeCoreEntryProps {
    token: string;
    /** Controlled mode — owned by the parent (dashboard page). */
    mode: VibeMode;
    /** Called for EASY ↔ MEDIUM changes. HARD is handled internally by this component. */
    onModeChange: (mode: VibeMode) => void;
}

export function VibeCoreEntry({ token, mode, onModeChange }: VibeCoreEntryProps) {
    const router = useRouter();
    const { t } = useTranslation();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [prompt, setPrompt] = useState("");
    const [files, setFiles] = useState<FilePill[]>([]);
    const [phase, setPhase] = useState<EntryPhase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    // Cmd/Ctrl + K focuses input from anywhere on the page
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                textareaRef.current?.focus();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    function handleModeChange(next: VibeMode) {
        if (next === "hard") {
            // HARD: create blank project + enter God Mode with auto-templating engine.
            // The parent resets the mode to "easy" so returning to dashboard shows EASY.
            void handleHardMode();
            return;
        }
        // EASY / MEDIUM: delegate to parent.
        onModeChange(next);
    }

    /**
     * HARD mode: creates a blank project (carrying current prompt + files if any),
     * then navigates to God Mode with autoTemplating=true so the workspace's
     * auto-templating engine can classify the intent on first generation.
     */
    async function handleHardMode() {
        setPhase("creating");
        try {
            const projectName = prompt.trim()
                ? prompt.trim().slice(0, 64)
                : t("vibecore.newProject", "Nuovo progetto");
            const projectResult = await createProject(token, projectName, undefined);
            const projectId = projectResult.project.id;

            if (files.length > 0) {
                setPhase("uploading");
                await Promise.allSettled(
                    files.map((pill) =>
                        uploadProjectAsset(token, projectId, pill.file, {
                            scope: "project",
                            useInProject: true,
                        }),
                    ),
                );
            }

            setPhase("redirecting");
            const query = new URLSearchParams({ autoTemplating: "true" });
            if (prompt.trim()) query.set("autoPrompt", prompt.trim().slice(0, 2000));
            router.push(`/workspace/${projectId}?${query.toString()}`);
        } catch {
            setError(t("vibecore.error", "Si è verificato un errore. Riprova."));
            setPhase("idle");
        }
    }

    const addFiles = useCallback((incoming: File[]) => {
        const valid = incoming.filter(
            (f) => f.size <= MAX_FILE_SIZE_BYTES && ACCEPTED_MIME_TYPES.includes(f.type),
        );
        setFiles((prev) =>
            [
                ...prev,
                ...valid.map((file) => ({ file, id: `${file.name}-${Date.now()}-${Math.random()}` })),
            ].slice(0, MAX_FILES),
        );
    }, []);

    function removeFile(id: string) {
        setFiles((prev) => prev.filter((p) => p.id !== id));
    }

    function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
        if (e.target.files) {
            addFiles(Array.from(e.target.files));
            e.target.value = "";
        }
    }

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        setIsDragOver(true);
    }

    function handleDragLeave(e: React.DragEvent) {
        // Only clear drag state when leaving the section entirely (not when moving to a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        setIsDragOver(false);
        if (e.dataTransfer.files) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    }

    // Auto-grow textarea
    function handlePromptChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setPrompt(e.target.value);
        const el = e.target;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight}px`;
    }

    async function handleSubmit(e?: React.FormEvent) {
        e?.preventDefault();
        if (!prompt.trim() || phase !== "idle") return;
        setError(null);

        try {
            // Layer Φ: classify intent
            setPhase("classifying");
            const classification = await classifyVibeIntent(token, {
                prompt: prompt.trim(),
                attachmentMeta: files.map((p) => ({
                    filename: p.file.name,
                    mimeType: p.file.type,
                    sizeBytes: p.file.size,
                })),
            }).catch(() => null);

            // Create project (with preset from classification if available)
            setPhase("creating");
            const projectName = prompt.trim().slice(0, 64) || "Progetto";
            const presetId = classification?.templateId ?? undefined;
            const projectResult = await createProject(token, projectName, presetId);
            const projectId = projectResult.project.id;

            // Upload files to the new project
            if (files.length > 0) {
                setPhase("uploading");
                await Promise.allSettled(
                    files.map((pill) =>
                        uploadProjectAsset(token, projectId, pill.file, {
                            scope: "project",
                            useInProject: true,
                        }),
                    ),
                );
            }

            // Redirect: templateId match → /launch (zero-effort runner), else → /workspace
            setPhase("redirecting");
            const query = new URLSearchParams({
                autoPrompt: prompt.trim().slice(0, 2000),
            });
            if (classification?.formatHint) {
                query.set("formatHint", classification.formatHint);
            }
            if (classification?.templateId) {
                // Template matched: use launch runner which applies the preset preprompt
                router.push(`/launch/${projectId}?${query.toString()}`);
            } else {
                // No template: open workspace for ad-hoc generation
                router.push(`/workspace/${projectId}?${query.toString()}`);
            }
        } catch {
            setError("Si è verificato un errore. Riprova.");
            setPhase("idle");
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSubmit();
        }
    }

    const glowColor = MODE_GLOW[mode];
    const isLoading = phase !== "idle";
    const phaseKey = PHASE_LABEL_KEYS[phase];
    const phaseLabel = phaseKey ? t(phaseKey, phase) : "";

    // Voice dictation — browser Speech-to-Text, language follows i18n selection
    const {
        listening: voiceListening,
        supported: voiceSupported,
        error: voiceError,
        toggle: toggleVoice,
    } = useSpeechDictation(prompt, setPrompt, {
        notSupported: t("workspace.ui.voiceOnlyChrome"),
        micError:     t("workspace.ui.voiceMicError"),
        unavailable:  (code) => t("workspace.ui.voiceUnavailable", { error: code }),
    });

    return (
        <section
            className="relative flex flex-col items-center justify-center w-full h-full"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Background blobs */}
            <VibeCoreBackground />

            {/* Blur overlay — absolute inside sticky section */}
            <ScrollBlurOverlay />

            {/* Mode selector — top right, above blur overlay (z-30) */}
            <div className="absolute top-4 right-4 z-30">
                <ModeSelector value={mode} onChange={handleModeChange} />
            </div>

            {/* Main entry card */}
            <div className="vc-entry-animate relative z-10 w-full max-w-2xl px-4">
                {/* Heading */}
                <h1
                    className="text-center font-bold text-foreground mb-2 tracking-tight"
                    style={{
                        fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                        lineHeight: 1.2,
                        letterSpacing: "-0.02em",
                    }}
                >
                    {t("vibecore.heading", "Cosa vuoi realizzare oggi?")}
                </h1>
                <p
                    className="text-center mb-6"
                    style={{ fontSize: "0.9rem", color: "rgba(255,255,255,0.45)", fontWeight: 400 }}
                >
                    {t("vibecore.subtitle", "Descrivi la tua idea — l'AI fa il resto")}
                </p>

                {/* Glass card */}
                <form
                    onSubmit={handleSubmit}
                    className={cn(
                        "rounded-[20px] p-4 transition-all duration-200",
                        isDragOver && "border-dashed",
                    )}
                    style={{
                        border: isDragOver
                            ? `1px dashed ${glowColor}80`
                            : `1px solid rgba(255,255,255,0.08)`,
                        background: "rgba(255,255,255,0.03)",
                        backdropFilter: "blur(24px) saturate(180%)",
                        boxShadow: `0 0 0 1px ${glowColor}40, 0 0 60px ${glowColor}0d, 0 24px 48px rgba(0,0,0,0.5)`,
                        transition: "box-shadow 200ms ease, border-color 400ms ease",
                    }}
                    onFocus={() => {
                        // Elevate glow on focus
                    }}
                >
                    {/* Textarea — extra padding for breathing room */}
                    <textarea
                        ref={textareaRef}
                        value={prompt}
                        onChange={handlePromptChange}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                        rows={3}
                        placeholder={t("vibecore.placeholder", "Es. una landing page per un salone di bellezza, tono elegante, palette neutra…")}
                        aria-label={t("vibecore.heading", "Cosa vuoi realizzare oggi?")}
                        className="w-full bg-transparent text-foreground resize-none outline-none text-sm leading-relaxed px-2 pt-2 pb-1"
                        style={{
                            color: "rgba(255,255,255,0.88)",
                            caretColor: glowColor,
                            minHeight: "80px",
                            maxHeight: "260px",
                            overflowY: "auto",
                        }}
                    />

                    {/* File pills */}
                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                            {files.map((pill) => (
                                <span
                                    key={pill.id}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                                    style={{
                                        background: "rgba(255,255,255,0.08)",
                                        color: "rgba(255,255,255,0.7)",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                    }}
                                >
                                    {pill.file.name.slice(0, 28)}
                                    {pill.file.name.length > 28 ? "…" : ""}
                                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.7em" }}>
                                        {(pill.file.size / 1024).toFixed(0)} KB
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={`Rimuovi ${pill.file.name}`}
                                        onClick={() => removeFile(pill.id)}
                                        className="ml-0.5 hover:text-white"
                                        style={{ color: "rgba(255,255,255,0.5)" }}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Divider */}
                    <div className="border-t mt-2 mb-3" style={{ borderColor: "rgba(255,255,255,0.07)" }} />

                    {/* Bottom row: attach · mic · status · send */}
                    <div className="flex items-center justify-between gap-2">
                        {/* Attach — dashed drop zone with dual click / drag functionality */}
                        <label
                            className={cn(
                                "flex items-center gap-1.5 cursor-pointer text-xs px-2.5 py-1.5 rounded-lg",
                                "transition-all duration-150 border border-dashed select-none",
                                (isLoading || files.length >= MAX_FILES) &&
                                    "opacity-40 pointer-events-none",
                            )}
                            style={{
                                color: isDragOver ? `${glowColor}dd` : "rgba(255,255,255,0.38)",
                                borderColor: isDragOver ? `${glowColor}70` : "rgba(255,255,255,0.15)",
                                background: isDragOver ? `${glowColor}14` : "transparent",
                            }}
                            title={t(
                                "vibecore.attachHint",
                                "Trascina file o clicca per allegare — PDF, DOCX, immagini, max 10 MB",
                            )}
                        >
                            {isDragOver ? (
                                <Upload className="h-3.5 w-3.5" />
                            ) : (
                                <Paperclip className="h-3.5 w-3.5" />
                            )}
                            <span>
                                {isDragOver
                                    ? t("vibecore.dropHere", "Rilascia qui")
                                    : t("vibecore.attach", "Allega")}
                            </span>
                            <span
                                className="hidden md:inline"
                                style={{
                                    fontSize: "0.68rem",
                                    color: isDragOver ? `${glowColor}90` : "rgba(255,255,255,0.18)",
                                }}
                            >
                                PDF · IMG · DOCX
                            </span>
                            <input
                                type="file"
                                multiple
                                accept=".pdf,.docx,image/png,image/jpeg,image/svg+xml"
                                className="sr-only"
                                onChange={handleFileInput}
                                disabled={isLoading || files.length >= MAX_FILES}
                            />
                        </label>

                        {/* Mic button — voice dictation (hidden when browser does not support Web Speech API) */}
                        {voiceSupported && (
                            <button
                                type="button"
                                onClick={toggleVoice}
                                disabled={isLoading}
                                aria-label={voiceListening
                                    ? t("workspace.ui.voiceListeningLabel")
                                    : t("workspace.ui.voiceStartLabel")}
                                title={voiceListening
                                    ? t("workspace.ui.voiceListeningTitle")
                                    : t("workspace.ui.voiceStartTitle")}
                                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 shrink-0"
                                style={{
                                    border: `1px solid ${
                                        voiceListening
                                            ? "rgba(248,113,113,0.5)"
                                            : "rgba(255,255,255,0.15)"
                                    }`,
                                    background: voiceListening
                                        ? "rgba(248,113,113,0.15)"
                                        : "transparent",
                                    color: voiceListening
                                        ? "#f87171"
                                        : "rgba(255,255,255,0.38)",
                                }}
                            >
                                {voiceListening
                                    ? <Square className="h-3.5 w-3.5" />
                                    : <Mic className="h-3.5 w-3.5" />}
                            </button>
                        )}

                        {/* Phase status */}
                        <span
                            aria-live="polite"
                            className="flex-1 text-center text-xs truncate"
                            style={{ color: "rgba(255,255,255,0.35)" }}
                        >
                            {phaseLabel}
                        </span>

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isLoading || !prompt.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: isLoading
                                    ? "rgba(255,255,255,0.08)"
                                    : `linear-gradient(135deg, ${glowColor}cc 0%, ${glowColor} 100%)`,
                                boxShadow: isLoading ? "none" : `0 0 20px ${glowColor}40`,
                            }}
                            aria-label={t("vibecore.cta", "Crea con AI")}
                        >
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    {t("vibecore.cta", "Crea con AI")}
                                    <ArrowRight className="h-3.5 w-3.5" />
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {/* Error */}
                {error && (
                    <p
                        role="alert"
                        className="mt-3 text-center text-sm"
                        style={{ color: "#f87171" }}
                    >
                        {error}
                    </p>
                )}

                {/* Voice status / error */}
                {(voiceListening || voiceError) && (
                    <div className="mt-2 flex items-center justify-center gap-2 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                        {voiceListening && (
                            <span className="flex items-center gap-1">
                                <span
                                    className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                                    style={{ background: "#f87171" }}
                                />
                                {t("workspace.ui.voiceListening")}
                            </span>
                        )}
                        {voiceError && (
                            <span style={{ color: "#f87171" }}>{voiceError}</span>
                        )}
                    </div>
                )}
            </div>

            {/* Scroll invite */}
            <div
                className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-1 z-10 pointer-events-none"
                style={{ color: "rgba(255,255,255,0.25)", fontSize: "0.75rem" }}
            >
                <span>{t("vibecore.scrollHint", "scorri per i tuoi progetti")}</span>
                <ChevronDown className="h-4 w-4 animate-bounce" style={{ animationDuration: "2s" }} />
            </div>
        </section>
    );
}
