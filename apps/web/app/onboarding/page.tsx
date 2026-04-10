"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
    getStyleTags,
    getUserStyleProfile,
    updateUserStyleProfile,
    type StyleTagDef,
    type StyleTagCatalog,
} from "../../lib/api";
import { getToken } from "../../lib/token-store";
import TagPicker from "../../components/TagPicker";

// Category-to-profile-field mappings
const CAT_TO_FIELD: Record<string, keyof SelectedTags> = {
    "TC-IDENTITY": "identityTags",
    "TC-SECTOR": "sectorTags",
    "TC-AUDIENCE": "audienceTags",
    "TC-VISUAL": "visualTags",
    "TC-PALETTE": "paletteTags",
    "TC-TYPOGRAPHY": "typographyTags",
    "TC-LAYOUT": "layoutTags",
    "TC-TONE": "toneTags",
    "TC-REFERENCE": "referenceTags",
    "TC-FEATURE": "featureTags",
};

const STEP_CATEGORIES = [
    ["TC-IDENTITY", "TC-SECTOR"],
    ["TC-VISUAL", "TC-PALETTE", "TC-TYPOGRAPHY", "TC-LAYOUT"],
    ["TC-AUDIENCE", "TC-TONE", "TC-REFERENCE", "TC-FEATURE"],
];

interface SelectedTags {
    identityTags: string[];
    sectorTags: string[];
    audienceTags: string[];
    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    referenceTags: string[];
    featureTags: string[];
}

const STEP_COUNT = 3;

const EMPTY_TAGS: SelectedTags = {
    identityTags: [],
    sectorTags: [],
    audienceTags: [],
    visualTags: [],
    paletteTags: [],
    typographyTags: [],
    layoutTags: [],
    toneTags: [],
    referenceTags: [],
    featureTags: [],
};

export default function OnboardingPage() {
    const router = useRouter();
    const { t } = useTranslation();
    const [token, setToken] = useState<string | null>(null);
    const [step, setStep] = useState(0);
    const [catalog, setCatalog] = useState<StyleTagCatalog>({});
    const [selected, setSelected] = useState<SelectedTags>(EMPTY_TAGS);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const tok = getToken();
        if (!tok) {
            router.replace("/login");
            return;
        }
        setToken(tok);

        // Load catalog + current profile in parallel
        Promise.all([getStyleTags(), getUserStyleProfile(tok)])
            .then(([catalogRes, profileRes]) => {
                setCatalog(catalogRes.catalog ?? {});
                const p = profileRes.profile;
                if (p.onboardingCompleted) {
                    // Already onboarded — skip to dashboard
                    router.replace("/dashboard");
                    return;
                }
                // Resume from saved step
                setStep(Math.min(p.onboardingStep ?? 0, STEP_COUNT - 1));
                setSelected({
                    identityTags: p.identityTags ?? [],
                    sectorTags: p.sectorTags ?? [],
                    audienceTags: p.audienceTags ?? [],
                    visualTags: p.visualTags ?? [],
                    paletteTags: p.paletteTags ?? [],
                    typographyTags: p.typographyTags ?? [],
                    layoutTags: p.layoutTags ?? [],
                    toneTags: p.toneTags ?? [],
                    referenceTags: p.referenceTags ?? [],
                    featureTags: p.featureTags ?? [],
                });
            })
            .catch(() => {
                // If style-tags fails (first boot, API cold start), still allow progression
                setCatalog({});
            })
            .finally(() => setLoading(false));
    }, [router]);

    async function saveStep(finalStep: boolean, skip = false) {
        if (!token) return;
        setSaving(true);
        setError(null);
        try {
            const nextStep = step + 1;
            const payload: Record<string, unknown> = {
                onboardingStep: nextStep,
                ...(finalStep ? { onboardingCompleted: true } : {}),
                ...(skip ? {} : selected),
            };
            await updateUserStyleProfile(token, payload);
            if (finalStep) {
                router.push("/dashboard");
            } else {
                setStep(nextStep);
            }
        } catch {
            setError(t("onboarding.saveError"));
        } finally {
            setSaving(false);
        }
    }

    function handleTagChange(field: keyof SelectedTags, ids: string[]) {
        setSelected((prev) => ({ ...prev, [field]: ids }));
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="text-center">
                    <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">{t("onboarding.loading")}</p>
                </div>
            </div>
        );
    }

    const isLast = step === STEP_COUNT - 1;
    const progressPct = Math.round(((step + 1) / STEP_COUNT) * 100);

    return (
        <div className="min-h-screen bg-background flex flex-col">
            {/* Top bar */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <span className="text-xl leading-none">🐱</span>
                    <span className="font-bold text-foreground text-sm tracking-tight">{t("brand.name")}</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                        {t("onboarding.step")} {step + 1} {t("onboarding.of")} {STEP_COUNT}
                    </span>
                    <button
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => saveStep(true, true)}
                        disabled={saving}
                    >
                        {t("onboarding.skipAll")}
                    </button>
                </div>
            </header>

            {/* Progress bar */}
            <div className="h-1 bg-secondary">
                <div
                    className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                />
            </div>

            {/* Content */}
            <main className="flex-1 flex flex-col items-center py-10 px-4">
                <div className="w-full max-w-2xl">
                    {/* Step header */}
                    <div className="mb-8 text-center">
                        <div className="inline-flex items-center gap-2 text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full mb-3">
                            <span>{t("onboarding.styleProfile")}</span>
                            <span className="text-primary/40">·</span>
                            <span>{t("onboarding.step")} {step + 1}/{STEP_COUNT}</span>
                        </div>
                        <h1 className="text-2xl font-bold text-foreground mb-2">{t(`onboarding.steps.${step}.title`)}</h1>
                        <p className="text-muted-foreground text-sm max-w-md mx-auto">{t(`onboarding.steps.${step}.subtitle`)}</p>
                    </div>

                    {/* Tag sections for current step */}
                    <div className="space-y-6">
                        {STEP_CATEGORIES[step]?.map((cat) => {
                            const field = CAT_TO_FIELD[cat];
                            const rawTags: StyleTagDef[] = catalog[cat] ?? [];
                            const tags = rawTags.map((tg) => ({
                                id: tg.id,
                                label: tg.label,
                                emoji: tg.emoji,
                                description: tg.description,
                            }));
                            if (tags.length === 0) return null;
                            return (
                                <div key={cat} className="bg-card rounded-xl border border-border p-5 shadow-sm">
                                    <h2 className="text-sm font-semibold text-foreground mb-3">
                                        {t(`onboarding.catLabels.${cat}`) ?? cat}
                                    </h2>
                                    <TagPicker
                                        tags={tags}
                                        selected={selected[field]}
                                        onChange={(ids) => handleTagChange(field, ids)}
                                        max={5}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {error && (
                        <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between mt-8">
                        {step > 0 ? (
                            <button
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                onClick={() => setStep((s) => s - 1)}
                                disabled={saving}
                            >
                                {t("onboarding.back")}
                            </button>
                        ) : (
                            <div />
                        )}
                        <div className="flex items-center gap-3">
                            <button
                                className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-2 rounded-lg hover:bg-secondary"
                                onClick={() => saveStep(isLast, true)}
                                disabled={saving}
                            >
                                {t("onboarding.skip")}
                            </button>
                            <button
                                className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50"
                                onClick={() => saveStep(isLast, false)}
                                disabled={saving}
                            >
                                {saving
                                    ? t("onboarding.saving")
                                    : isLast
                                    ? t("onboarding.complete")
                                    : t("onboarding.next")}
                            </button>
                        </div>
                    </div>

                    {/* Step dots */}
                    <div className="flex justify-center gap-2 mt-6">
                        {Array.from({ length: STEP_COUNT }).map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all ${
                                    i === step
                                        ? "w-6 bg-primary"
                                        : i < step
                                        ? "w-2 bg-primary/50"
                                        : "w-2 bg-border"
                                }`}
                            />
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
}
