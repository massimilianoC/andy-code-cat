"use client";

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import VideoModal from "./VideoModal";

interface GuideBannerProps {
    videoUrl?: string;
    deepLinkUrl?: string;
    title?: string;
    subtitle?: string;
    ctaLabel?: string;
    className?: string;
}

export default function GuideBanner({
    videoUrl,
    deepLinkUrl,
    title,
    subtitle,
    ctaLabel,
    className = "",
}: GuideBannerProps) {
    const { t } = useTranslation();
    const resolvedTitle = title ?? t("guide.title");
    const resolvedSubtitle = subtitle ?? t("guide.subtitle");
    const resolvedCta = ctaLabel ?? t("guide.cta");
    const [videoOpen, setVideoOpen] = useState(false);

    function handleClick() {
        if (videoUrl) {
            setVideoOpen(true);
        } else if (deepLinkUrl) {
            window.open(deepLinkUrl, "_blank", "noopener,noreferrer");
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={handleClick}
                className={[
                    "group w-full text-left rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 p-0.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    className,
                ].join(" ")}
                aria-label={resolvedCta}
            >
                <div className="w-full flex items-center gap-4 rounded-[10px] bg-card/95 group-hover:bg-card px-5 py-4 transition-colors">
                    {/* Play icon */}
                    <div className="shrink-0 w-11 h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
                        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{resolvedTitle}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{resolvedSubtitle}</p>
                    </div>

                    {/* CTA */}
                    <span className="shrink-0 text-xs font-medium text-primary group-hover:text-primary/80 transition-colors hidden sm:block">
                        {resolvedCta} →
                    </span>
                </div>
            </button>

            {videoUrl && (
                <VideoModal
                    isOpen={videoOpen}
                    onClose={() => setVideoOpen(false)}
                    videoUrl={videoUrl}
                    title={resolvedTitle}
                />
            )}
        </>
    );
}
