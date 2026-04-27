"use client";

import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";

/**
 * Wraps the app with the i18next provider.
 * i18n is initialised with lng:"it" so server and client render identically
 * (avoiding hydration mismatch). After mount we apply the stored preference.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        // Apply stored language after hydration completes
        const stored = localStorage.getItem("andy_lang");
        const target = stored ?? navigator.language?.split("-")[0] ?? "it";
        const lang = ["it", "en"].includes(target) ? target : "it";
        if (i18n.language !== lang) {
            i18n.changeLanguage(lang);
        }

        // Keep <html lang="..."> in sync with the active language
        const update = () => {
            document.documentElement.lang = i18n.language?.split("-")[0] ?? "it";
        };
        update();
        i18n.on("languageChanged", update);
        return () => i18n.off("languageChanged", update);
    }, []);

    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
