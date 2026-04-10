"use client";

import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n";

/**
 * Wraps the app with the i18next provider.
 * The i18n singleton is initialised once (in lib/i18n.ts) with browser language
 * detection → localStorage fallback → "it" as default.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
    // Keep <html lang="..."> in sync with the active language
    useEffect(() => {
        const update = () => {
            document.documentElement.lang = i18n.language?.split("-")[0] ?? "it";
        };
        update();
        i18n.on("languageChanged", update);
        return () => i18n.off("languageChanged", update);
    }, []);

    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
