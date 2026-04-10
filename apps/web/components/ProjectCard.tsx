"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Project } from "../lib/api";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getThumbnail, getPromptExcerpt, getSnapCount } from "@/lib/thumbnail";

interface ProjectCardProps {
    project: Project;
    onOpen: (project: Project) => void;
    onDuplicate: (project: Project) => void;
    onDelete: (project: Project) => void;
    onCopyPrompt?: (project: Project) => void;
}

const GRADIENT_PALETTES = [
    "from-indigo-400 to-purple-500",
    "from-sky-400 to-blue-600",
    "from-emerald-400 to-teal-600",
    "from-rose-400 to-pink-600",
    "from-amber-400 to-orange-500",
    "from-violet-400 to-indigo-600",
    "from-cyan-400 to-sky-600",
    "from-fuchsia-400 to-purple-600",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function relativeTime(dateString: string, t: (key: string, opts?: any) => string): string {
    const diff = Date.now() - new Date(dateString).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 2) return t("time.justNow");
    if (minutes < 60) return t("time.minutesAgo", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("time.hoursAgo", { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return t("time.daysAgo", { count: days });
    return new Date(dateString).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function ProjectCard({ project, onOpen, onDuplicate, onDelete, onCopyPrompt }: ProjectCardProps) {
    const { t } = useTranslation();
    const gradientIndex = project.id.charCodeAt(0) % GRADIENT_PALETTES.length;
    const gradient = GRADIENT_PALETTES[gradientIndex];

    const [thumbnail, setThumbnail] = useState<string | null>(null);
    const [promptExcerpt, setPromptExcerpt] = useState<string | null>(null);
    const [snapCount, setSnapCount] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        setThumbnail(getThumbnail(project.id));
        setPromptExcerpt(getPromptExcerpt(project.id));
        setSnapCount(getSnapCount(project.id));
    }, [project.id]);

    return (
        <div className="group relative bg-card rounded-2xl border border-border overflow-hidden hover:shadow-xl hover:border-primary/40 transition-all duration-200 flex flex-col">
            {/* Thumbnail — full-width top section */}
            <button
                className="relative overflow-hidden flex-shrink-0 cursor-pointer focus:outline-none w-full"
                style={{ height: "220px" }}
                onClick={() => onOpen(project)}
                aria-label={`Apri ${project.name}`}
            >
                {thumbnail ? (
                    /* Render actual snapshot HTML at reduced scale */
                    <div className="absolute inset-0 overflow-hidden">
                        <iframe
                            ref={iframeRef}
                            srcDoc={thumbnail}
                            title={`Anteprima ${project.name}`}
                            sandbox=""
                            scrolling="no"
                            aria-hidden="true"
                            style={{
                                width: "960px",
                                height: "640px",
                                border: "none",
                                transform: "scale(0.37)",
                                transformOrigin: "top left",
                                pointerEvents: "none",
                                userSelect: "none",
                            }}
                        />
                    </div>
                ) : (
                    /* Gradient fallback with initial letter */
                    <div className={`absolute inset-0 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                        <span className="text-white/40 text-8xl font-bold select-none">
                            {project.name.charAt(0).toUpperCase()}
                        </span>
                    </div>
                )}
                {/* Hover overlay with CTA */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors duration-200 flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white text-sm font-semibold bg-black/60 px-4 py-2 rounded-lg pointer-events-none">
                        {t("card.openWorkspaceHover")}
                    </span>
                </div>
            </button>

            {/* Info strip */}
            <div className="flex flex-col flex-1 p-4 gap-1.5">
                {/* Title row */}
                <div className="flex items-start justify-between gap-2">
                    <button
                        className="flex-1 min-w-0 text-left font-semibold text-foreground text-sm leading-snug truncate hover:text-primary transition-colors"
                        onClick={() => onOpen(project)}
                    >
                        {project.name}
                    </button>

                    {/* Context menu */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                className="flex-shrink-0 p-1 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                                aria-label={t("card.options")}
                            >
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                                </svg>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => onOpen(project)} className="gap-2 cursor-pointer">
                                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                </svg>
                                {t("card.menu.open")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onDuplicate(project)} className="gap-2 cursor-pointer">
                                <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                {t("card.menu.duplicate")}
                            </DropdownMenuItem>
                            {onCopyPrompt && (
                                <DropdownMenuItem onClick={() => onCopyPrompt(project)} className="gap-2 cursor-pointer">
                                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                                    </svg>
                                    {t("card.menu.copyPrompt")}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => onDelete(project)}
                                className="gap-2 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                {t("card.menu.delete")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Meta row: date + version count */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">{relativeTime(project.createdAt, t)}</span>
                    {snapCount > 0 && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto">
                            {t("card.version", { count: snapCount })}
                        </Badge>
                    )}
                </div>

                {/* Prompt excerpt */}
                {promptExcerpt && (
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {promptExcerpt}
                    </p>
                )}
            </div>
        </div>
    );
}
