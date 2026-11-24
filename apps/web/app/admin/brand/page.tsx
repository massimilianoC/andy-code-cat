"use client";

import { useEffect, useState } from "react";
import { AdminPageHeader } from "@/components/admin/AdminUi";
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
        <div className="max-w-3xl">
            <AdminPageHeader
                eyebrow="Advanced"
                title="Brand"
                description={<>Platform brand assets, added to every project prompt as platform-level identity. Assets marked <strong>Must Use</strong> are mandatory in all generations.</>}
            />

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
