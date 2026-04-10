"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LoginForm } from "@/components/LoginForm";
import { saveSession } from "@/lib/token-store";
import type { LoginResult } from "@/lib/api";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { t } = useTranslation();
    const afterOnboarding = searchParams.get("registered") === "1";
    const prefillEmail = searchParams.get("email") ?? undefined;

    function handleSuccess(data: LoginResult) {
        saveSession(data.accessToken, data.refreshToken, data.activeProjectId);
        router.push(afterOnboarding ? "/onboarding" : "/dashboard");
    }

    return (
        <div className="max-w-sm mx-auto">
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="text-xl">{t("login.title")}</CardTitle>
                    <CardDescription>{t("login.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <LoginForm onSuccess={handleSuccess} prefillEmail={prefillEmail} />
                </CardContent>
                <CardFooter className="justify-center border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                        {t("login.noAccount")}{" "}
                        <a href="/register" className="text-primary hover:underline font-medium">
                            {t("login.createAccount")}
                        </a>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={null}>
            <LoginContent />
        </Suspense>
    );
}


