import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "../i18n/en.json";
import it from "../i18n/it.json";

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            en: { translation: en },
            it: { translation: it },
        },
        fallbackLng: "it",
        supportedLngs: ["it", "en"],
        interpolation: {
            escapeValue: false, // React already escapes output
        },
        detection: {
            // Order: localStorage → browser language → fallback
            order: ["localStorage", "navigator"],
            lookupLocalStorage: "andy_lang",
            caches: ["localStorage"],
        },
    });

export default i18n;
