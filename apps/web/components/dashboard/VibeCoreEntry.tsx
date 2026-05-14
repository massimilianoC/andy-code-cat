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
import { classifyVibeIntent, prefillZeroEffort } from "@/lib/api/vibecore";
import { getZeroEffortConfig } from "@/lib/api/pipelines";
import { createProject, uploadProjectAsset, renameProject } from "@/lib/api";

/** Max file size accepted via the VibeCore drag-and-drop zone (10 MB). */
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 3;
const VIBE_MODE_KEY = "vibecore_mode";
const ACCEPTED_MIME_TYPES = [
    // Documents
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/html",
    "application/xhtml+xml",
    "text/csv",
    "application/csv",
    // Spreadsheets
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    // Presentations
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    // Images
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "image/bmp",
    "image/tiff",
    // Modern image formats — transcoded server-side before vision LLM
    "image/heic",
    "image/heif",
    "image/avif",
];

type EntryPhase = "idle" | "classifying" | "prefilling" | "creating" | "uploading" | "redirecting";

/** i18n keys for phase labels — translated at render time. */
const PHASE_LABEL_KEYS: Record<EntryPhase, string> = {
    idle:        "",
    classifying: "vibecore.phase.classifying",
    prefilling:  "vibecore.phase.prefilling",
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
    // Cycling hint index — advances every 2.3s with a short fade-out/-in transition
    const [hintIndex, setHintIndex] = useState(0);
    const [hintVisible, setHintVisible] = useState(true);

    useEffect(() => {
        if (phase === "idle") {
            setHintIndex(0);
            setHintVisible(true);
            return;
        }
        const timer = setInterval(() => {
            setHintVisible(false);
            setTimeout(() => {
                setHintIndex((prev) => prev + 1);
                setHintVisible(true);
            }, 280);
        }, 2300);
        return () => clearInterval(timer);
    }, [phase]);

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
            // HARD: create blank project + enter Guided Mode (God Mode workspace) with auto-templating engine.
            // The parent resets the mode to "easy" so returning to dashboard shows EASY.
            void handleHardMode();
            return;
        }
        // EASY / MEDIUM: delegate to parent.
        onModeChange(next);
    }

    /**
     * HARD mode: creates a blank project (carrying current prompt + files if any),
     * then navigates to Guided Mode (God Mode workspace) with autoTemplating=true so the workspace's
     * auto-templating engine can classify the intent on first generation.
     * The god_mode_generate superadmin config determines which provider/model is used.
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

            // Apply god_mode_generate model so workspace uses the superadmin-configured model.
            try {
                const pipelineConfig = await getZeroEffortConfig(token, projectId);
                if (pipelineConfig?.godModeGenerate?.provider) {
                    query.set("preferredProvider", pipelineConfig.godModeGenerate.provider);
                }
                if (pipelineConfig?.godModeGenerate?.model) {
                    query.set("preferredModel", pipelineConfig.godModeGenerate.model);
                }
            } catch {
                // Non-blocking: proceed without preferred model if config fetch fails
            }

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
            const attachmentMeta = files.map((p) => ({
                filename: p.file.name,
                mimeType: p.file.type,
                sizeBytes: p.file.size,
            }));
            const classification = await classifyVibeIntent(token, {
                prompt: prompt.trim(),
                attachmentMeta,
            }).catch(() => null);

            // Create project early so files (and their Layer D enrichment) can be uploaded
            // before the LLM prefill pass runs
            setPhase("creating");
            const projectName = prompt.trim().slice(0, 64) || "Progetto";
            const presetId = classification?.templateId ?? undefined;
            const projectResult = await createProject(token, projectName, presetId);
            const projectId = projectResult.project.id;

            // Upload files to the new project (triggers async enrichment pipeline)
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

            // LLM prefill pass — now includes Layer D document context from uploaded assets
            setPhase("prefilling");
            const prefillResult = await prefillZeroEffort(token, {
                prompt: prompt.trim(),
                projectId,
                attachmentMeta,
                templateId: classification?.templateId ?? null,
                formatHint: classification?.formatHint ?? null,
            }).catch(() => null);

            // Store prefill draft in sessionStorage for launch page
            const hasPrefill = prefillResult && !prefillResult.skipped;
            if (hasPrefill) {
                // Rename the project with the AI-extracted business name so the launch
                // page and brief prompt start with a clean, meaningful title.
                const aiName = prefillResult.draft.businessName?.trim();
                if (aiName && aiName.length >= 2) {
                    renameProject(token, projectId, aiName.slice(0, 120)).catch(() => { });
                }
                try {
                    sessionStorage.setItem(
                        `ze_prefill_${projectId}`,
                        JSON.stringify(prefillResult.draft),
                    );
                } catch {
                    // sessionStorage unavailable — launch page falls back to manual wizard
                }
            }

            // Always navigate to launch page (zero-effort flow)
            setPhase("redirecting");
            const query = new URLSearchParams({
                autoPrompt: prompt.trim().slice(0, 2000),
            });
            if (classification?.formatHint) query.set("formatHint", classification.formatHint);
            if (hasPrefill) query.set("prefilled", "1");
            router.push(`/launch/${projectId}?${query.toString()}`);
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
                        onInput={(e) => {
                            // Capture OS-level native dictation events (macOS Dictation,
                            // Windows Voice Typing) that React's onChange may miss.
                            const el = e.target as HTMLTextAreaElement;
                            setPrompt(el.value);
                            el.style.height = "auto";
                            el.style.height = `${el.scrollHeight}px`;
                        }}
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
                                PDF · DOCX · XLS · PPT · IMG · TXT
                            </span>
                            <input
                                type="file"
                                multiple
                                accept=".pdf,.docx,.doc,.txt,.md,.html,.csv,.xlsx,.xls,.pptx,.ppt,image/*"
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

                {/* Loading hints — 3 pulsing dots + cycling keyword phrase */}
                {isLoading && (() => {
                    const rawHints = t(`vibecore.phase.hints.${phase}`, { returnObjects: true });
                    const arr: string[] = Array.isArray(rawHints) ? rawHints as string[] : [];
                    const hint = arr.length > 0 ? arr[hintIndex % arr.length] : "";
                    return (
                        <div className="mt-3 flex flex-col items-center gap-1.5">
                            {/* Staggered pulsing dots */}
                            <div className="flex items-center gap-1">
                                {[0, 1, 2].map((i) => (
                                    <span
                                        key={i}
                                        className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                                        style={{
                                            background: glowColor,
                                            animationDelay: `${i * 0.22}s`,
                                            animationDuration: "1.2s",
                                        }}
                                    />
                                ))}
                            </div>
                            {/* Cycling hint text */}
                            {hint && (
                                <p
                                    aria-live="polite"
                                    className="text-center"
                                    style={{
                                        fontSize: "0.72rem",
                                        color: `${glowColor}cc`,
                                        letterSpacing: "0.025em",
                                        opacity: hintVisible ? 1 : 0,
                                        transform: hintVisible ? "translateY(0)" : "translateY(5px)",
                                        transition: "opacity 280ms ease, transform 280ms ease",
                                    }}
                                >
                                    {hint}
                                </p>
                            )}
                        </div>
                    );
                })()}

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
