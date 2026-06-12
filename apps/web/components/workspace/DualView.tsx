"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface DualViewProps {
    leftPane: React.ReactNode;
    rightPane: React.ReactNode;
    defaultSplit?: number;
    className?: string;
}

const SPLIT_COOKIE = "andy-code-cat_dual_split";

function getCookie(name: string): string | undefined {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : undefined;
}

function setCookie(name: string, value: string, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

export function DualView({ leftPane, rightPane, defaultSplit = 50, className }: DualViewProps) {
    const [split, setSplit] = useState(defaultSplit);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const saved = Number(getCookie(SPLIT_COOKIE));
        if (!Number.isNaN(saved) && saved >= 20 && saved <= 80) {
            setSplit(saved);
        }
    }, []);

    const onMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!isDragging || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const pct = ((e.clientX - rect.left) / rect.width) * 100;
            const clamped = Math.max(20, Math.min(80, pct));
            setSplit(clamped);
        },
        [isDragging]
    );

    const onMouseUp = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);
        setCookie(SPLIT_COOKIE, String(Math.round(split)));
    }, [isDragging, split]);

    useEffect(() => {
        if (!isDragging) return;
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
    }, [isDragging, onMouseMove, onMouseUp]);

    return (
        <div ref={containerRef} className={cn("flex w-full h-full relative", className)}>
            <div className="overflow-auto" style={{ width: `${split}%` }}>
                {leftPane}
            </div>
            <div
                className="w-1.5 cursor-col-resize bg-border hover:bg-primary/40 shrink-0 z-10 transition-colors"
                onMouseDown={() => setIsDragging(true)}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panels"
            />
            <div className="overflow-auto min-w-0" style={{ width: `${100 - split - 0.5}%` }}>
                {rightPane}
            </div>
        </div>
    );
}
