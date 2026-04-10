"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { getToken } from "@/lib/token-store";
import { Button } from "@/components/ui/button";

export default function HomePage() {
    const router = useRouter();
    const { t } = useTranslation();

    useEffect(() => {
        if (getToken()) {
            router.replace("/dashboard");
        }
    }, [router]);

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-8">
            {/* Brand */}
            <div className="space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <span className="text-4xl leading-none select-none">🐱</span>
                </div>
                <div>
                    <h1 className="text-3xl font-bold text-foreground tracking-tight">{t("brand.name")}</h1>
                    <p className="mt-1 text-sm font-medium text-primary">{t("brand.tagline")}</p>
                    <p className="mt-2 text-muted-foreground max-w-xs mx-auto">
                        {t("home.sub")}
                    </p>
                </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
                <Button asChild size="lg" className="flex-1">
                    <a href="/login">{t("home.cta.login")}</a>
                </Button>
                <Button asChild variant="outline" size="lg" className="flex-1">
                    <a href="/register">{t("home.cta.register")}</a>
                </Button>
            </div>
        </div>
    );
}

