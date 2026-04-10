"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { HealthStatusButton } from "@/components/HealthStatusButton";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function PublicLayout({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    return (
        <div className="shell">
            <nav className="justify-between">
                <a href="/" className="brand flex items-center gap-1.5">
                    <span className="text-primary text-lg">🐱</span>
                    <span className="font-bold tracking-tight">{t("brand.name")}</span>
                </a>
                <div className="flex items-center gap-1">
                    <LanguageSwitcher className="mr-1" />
                    <HealthStatusButton />
                    <Button variant="ghost" size="sm" asChild>
                        <a href="/login">{t("nav.login")}</a>
                    </Button>
                    <Button size="sm" asChild>
                        <a href="/register">{t("nav.register")}</a>
                    </Button>
                </div>
            </nav>
            <main>{children}</main>
        </div>
    );
}
