import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../i18n/en.json";
import it from "../i18n/it.json";

// Always initialise with "it" so server-rendered HTML and the initial
// client render are identical (prevents React hydration mismatch).
// I18nProvider.tsx reads localStorage and switches language after mount.
i18n.use(initReactI18next).init({
    resources: {
        en: { translation: en },
        it: { translation: it },
    },
    lng: "it",
    fallbackLng: "it",
    supportedLngs: ["it", "en"],
    interpolation: {
        escapeValue: false,
    },
});

export default i18n;
