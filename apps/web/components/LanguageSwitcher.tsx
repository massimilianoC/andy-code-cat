"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const LANGS = [
    { code: "it", flag: "🇮🇹" },
    { code: "en", flag: "🇬🇧" },
] as const;

interface LanguageSwitcherProps {
    className?: string;
}

export function LanguageSwitcher({ className }: LanguageSwitcherProps) {
    const { i18n, t } = useTranslation();
    const current = i18n.language?.split("-")[0] ?? "it";

    return (
        <div
            className={cn("flex items-center gap-0.5", className)}
            role="group"
            aria-label="Language selector"
        >
            {LANGS.map(({ code, flag }) => (
                <button
                    key={code}
                    onClick={() => i18n.changeLanguage(code)}
                    className={cn(
                        "text-base leading-none px-1 py-0.5 rounded transition-opacity",
                        current === code
                            ? "opacity-100 ring-1 ring-primary/40 bg-primary/10"
                            : "opacity-40 hover:opacity-70"
                    )}
                    aria-label={t(`lang.${code}`)}
                    aria-pressed={current === code}
                    title={t(`lang.${code}`)}
                >
                    {flag}
                </button>
            ))}
        </div>
    );
}
