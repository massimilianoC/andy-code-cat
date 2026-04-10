"use client";

import React, { useEffect, useCallback } from "react";

interface VideoModalProps {
    isOpen: boolean;
    onClose: () => void;
    videoUrl: string;
    title?: string;
}

export default function VideoModal({ isOpen, onClose, videoUrl, title }: VideoModalProps) {
    const handleKey = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        },
        [onClose]
    );

    useEffect(() => {
        if (!isOpen) return;
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [isOpen, handleKey]);

    if (!isOpen) return null;

    // Detect YouTube URLs and convert to embed
    function toEmbedUrl(url: string): string {
        const ytMatch = url.match(
            /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
        );
        if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`;
        return url;
    }

    const embedUrl = toEmbedUrl(videoUrl);
    const isIframe = embedUrl.startsWith("https://");

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Video guida"}
        >
            <div
                className="relative w-full max-w-4xl bg-black rounded-2xl overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                    onClick={onClose}
                    aria-label="Chiudi"
                >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Title */}
                {title && (
                    <div className="absolute top-3 left-4 z-10">
                        <span className="text-sm font-medium text-white/80 bg-black/50 px-2 py-1 rounded">
                            {title}
                        </span>
                    </div>
                )}

                {/* Video area — 16:9 */}
                <div className="relative w-full" style={{ paddingTop: "56.25%" }}>
                    {isIframe ? (
                        <iframe
                            className="absolute inset-0 w-full h-full"
                            src={embedUrl}
                            title={title ?? "Video"}
                            frameBorder="0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    ) : (
                        // Direct video file
                        <video
                            className="absolute inset-0 w-full h-full object-contain"
                            src={videoUrl}
                            controls
                            autoPlay
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
