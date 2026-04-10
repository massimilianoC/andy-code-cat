"use client";

import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Tip {
    id: string;
    type: "tip" | "news" | "shortcut";
    key: string;
    icon: string;
}

const TIPS: Tip[] = [
    { id: "tip-onboarding",  type: "tip",      key: "onboarding", icon: "🎨" },
    { id: "tip-duplicate",   type: "tip",      key: "duplicate",  icon: "📋" },
    { id: "tip-prompt",      type: "tip",      key: "prompt",     icon: "💬" },
    { id: "news-streaming",  type: "news",     key: "streaming",  icon: "⚡" },
    { id: "news-publish",    type: "news",     key: "publish",    icon: "🚀" },
    { id: "shortcut-save",   type: "shortcut", key: "save",       icon: "⌨️" },
];

const TYPE_CLASS: Record<Tip["type"], string> = {
    tip:      "bg-primary/10 text-primary",
    news:     "bg-success/10 text-success",
    shortcut: "bg-amber-500/10 text-amber-400",
};

const SEEN_KEY = "andy_tips_seen";

function getSeenIds(): string[] {
    try {
        return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    } catch {
        return [];
    }
}

function markSeen(id: string) {
    const seen = getSeenIds();
    if (!seen.includes(id)) {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
    }
}

// ── Drawer panel content ────────────────────────────────────────────────────

interface TipsPanelProps {
    onClose?: () => void;
}

export default function TipsPanel({ onClose }: TipsPanelProps) {
    const { t } = useTranslation();
    const [seenIds, setSeenIds] = useState<string[]>([]);

    useEffect(() => {
        setSeenIds(getSeenIds());
    }, []);

    function handleSeen(id: string) {
        markSeen(id);
        setSeenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }

    return (
        <div className="flex flex-col h-full">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <span className="text-sm font-semibold text-foreground">{t("tips.title")}</span>
                {onClose && (
                    <button
                        className="p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        onClick={onClose}
                        aria-label={t("tips.closePanel")}
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>

            {/* Tip list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {TIPS.map((tip) => {
                    const isSeen = seenIds.includes(tip.id);
                    const typeClass = TYPE_CLASS[tip.type];
                    return (
                        <div
                            key={tip.id}
                            className={`p-3 rounded-lg border transition-opacity ${
                                isSeen
                                    ? "opacity-60 border-border bg-card/50"
                                    : "border-primary/20 bg-card shadow-sm"
                            }`}
                        >
                            <div className="flex items-start gap-2">
                                <span className="text-xl leading-none mt-0.5">{tip.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${typeClass}`}>
                                            {t(`tips.types.${tip.type}`)}
                                        </span>
                                    </div>
                                    <p className="text-xs font-semibold text-foreground">{t(`tips.items.${tip.key}.title`)}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{t(`tips.items.${tip.key}.body`)}</p>
                                    {!isSeen && (
                                        <button
                                            className="mt-1.5 text-xs text-primary hover:text-primary/80"
                                            onClick={() => handleSeen(tip.id)}
                                        >
                                            {t("tips.markRead")}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Floating Action Button + overlay drawer ─────────────────────────────────

export function TipsFab() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        const seen = getSeenIds();
        setUnreadCount(TIPS.filter((tip) => !seen.includes(tip.id)).length);
    }, []);

    return (
        <>
            {/* FAB button — fixed bottom-right */}
            <button
                className="fixed bottom-6 right-6 z-40 flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
                onClick={() => setOpen(true)}
                aria-label={t("tips.fabLabel")}
                title={t("tips.title")}
            >
                {/* Lightbulb icon */}
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] flex items-center justify-center text-[0.6rem] font-bold bg-destructive text-destructive-foreground rounded-full px-0.5">
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Backdrop */}
            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/40"
                    onClick={() => setOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Slide-in drawer from the right */}
            <div
                className={`fixed top-0 right-0 h-full w-80 z-50 bg-card border-l border-border shadow-2xl transition-transform duration-200 ${
                    open ? "translate-x-0" : "translate-x-full"
                }`}
                role="dialog"
                aria-modal="true"
                aria-label={t("tips.title")}
            >
                <TipsPanel onClose={() => setOpen(false)} />
            </div>
        </>
    );
}

// ── Inline chip button for footer bar ──────────────────────────────────────

export function TipsChip() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        const seen = getSeenIds();
        setUnreadCount(TIPS.filter((tip) => !seen.includes(tip.id)).length);
    }, []);

    return (
        <>
            <button
                className="relative flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
                onClick={() => setOpen(true)}
                aria-label={t("tips.fabLabel")}
                title={t("tips.title")}
            >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>{t("tips.chip")}</span>
                {unreadCount > 0 && (
                    <span className="min-w-[1.1rem] h-[1.1rem] flex items-center justify-center text-[0.6rem] font-bold bg-destructive text-destructive-foreground rounded-full px-0.5">
                        {unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-40 bg-black/40"
                    onClick={() => setOpen(false)}
                    aria-hidden="true"
                />
            )}

            <div
                className={`fixed top-0 right-0 h-full w-80 z-50 bg-card border-l border-border shadow-2xl transition-transform duration-200 ${
                    open ? "translate-x-0" : "translate-x-full"
                }`}
                role="dialog"
                aria-modal="true"
                aria-label={t("tips.title")}
            >
                <TipsPanel onClose={() => setOpen(false)} />
            </div>
        </>
    );
}
