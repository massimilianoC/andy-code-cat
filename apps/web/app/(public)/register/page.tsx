"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { register, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

export default function RegisterPage() {
    const router = useRouter();
    const { t } = useTranslation();
    const [fields, setFields] = useState({ email: "", password: "", firstName: "", lastName: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function set(key: keyof typeof fields, val: string) {
        setFields((f) => ({ ...f, [key]: val }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await register(fields);
            router.push(`/login?registered=1&email=${encodeURIComponent(fields.email)}`);
        } catch (err) {
            const msg = err instanceof ApiError
                ? (typeof err.body === "object" && err.body !== null && "error" in err.body
                    ? String((err.body as { error: unknown }).error)
                    : `Errore ${err.status}`)
                : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="max-w-sm mx-auto">
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="text-xl">{t("register.title")}</CardTitle>
                    <CardDescription>{t("register.description")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="reg-firstName">{t("register.firstName")}</Label>
                                <Input
                                    id="reg-firstName"
                                    type="text"
                                    value={fields.firstName}
                                    onChange={(e) => set("firstName", e.target.value)}
                                    placeholder="Mario"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="reg-lastName">{t("register.lastName")}</Label>
                                <Input
                                    id="reg-lastName"
                                    type="text"
                                    value={fields.lastName}
                                    onChange={(e) => set("lastName", e.target.value)}
                                    placeholder="Rossi"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="reg-email">{t("register.email")}</Label>
                            <Input
                                id="reg-email"
                                type="email"
                                required
                                value={fields.email}
                                onChange={(e) => set("email", e.target.value)}
                                placeholder="mario@example.com"
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="reg-password">
                                {t("register.password")}{" "}
                                <span className="text-muted-foreground font-normal">{t("register.passwordHint")}</span>
                            </Label>
                            <Input
                                id="reg-password"
                                type="password"
                                required
                                minLength={8}
                                value={fields.password}
                                onChange={(e) => set("password", e.target.value)}
                                placeholder="••••••••"
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                                ⚠ {error}
                            </div>
                        )}

                        <Button type="submit" disabled={loading} className="w-full mt-1">
                            {loading ? t("register.submitting") : t("register.submit")}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="justify-center border-t border-border pt-4">
                    <p className="text-sm text-muted-foreground">
                        {t("register.haveAccount")}{" "}
                        <a href="/login" className="text-primary hover:underline font-medium">
                            {t("register.login")}
                        </a>
                    </p>
                </CardFooter>
            </Card>
        </div>
    );
}

