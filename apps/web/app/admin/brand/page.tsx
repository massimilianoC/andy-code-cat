"use client";

import { useEffect, useState } from "react";
import { getToken } from "@/lib/token-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandAssetsManager } from "@/components/brand/BrandAssetsManager";

export default function AdminBrandPage() {
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        setToken(getToken());
    }, []);

    if (!token) return null;

    return (
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1.5rem" }}>
            <div style={{ marginBottom: "1.5rem" }}>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text)", marginBottom: "0.25rem" }}>
                    Platform Brand Identity
                </h1>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Brand assets defined here are injected into every project prompt as platform-level identity.
                    Assets marked <strong>Must Use</strong> are mandatory in all generations.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Platform Assets</CardTitle>
                    <CardDescription className="text-xs">
                        Applies to all users and projects. Ordered before user and project scope.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <BrandAssetsManager scope="platform" token={token} allowFileUpload={true} />
                </CardContent>
            </Card>
        </div>
    );
}
