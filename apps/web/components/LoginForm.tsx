"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { login, type LoginResult } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LoginFormProps {
    /**
     * Called after a successful login.
     * The parent is responsible for persisting the tokens and closing any modal.
     */
    onSuccess: (result: LoginResult) => void;
    /**
     * When true, the form uses compact modal-friendly styling instead of the
     * full-page card layout.
     */
    embedded?: boolean;
    /** Pre-fill the email field (e.g. passed from the registration flow). */
    prefillEmail?: string;
}

export function LoginForm({ onSuccess, embedded = false, prefillEmail }: LoginFormProps) {
    const { t } = useTranslation();
    const [fields, setFields] = useState({ email: prefillEmail ?? "", password: "" });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function set(key: "email" | "password", val: string) {
        setFields((f) => ({ ...f, [key]: val }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            const data = await login(fields);
            onSuccess(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t("login.failed"));
        } finally {
            setLoading(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                    ⚠ {error}
                </div>
            )}

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-email">Email *</Label>
                <Input
                    id="login-email"
                    type="email"
                    required
                    value={fields.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="mario@example.com"
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-password">Password *</Label>
                <Input
                    id="login-password"
                    type="password"
                    required
                    value={fields.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder="••••••••"
                />
            </div>

            <Button type="submit" disabled={loading} className={embedded ? "self-end min-w-28" : "w-full mt-1"}>
                {loading ? t("login.submitting") : t("login.submit")}
            </Button>
        </form>
    );
}

