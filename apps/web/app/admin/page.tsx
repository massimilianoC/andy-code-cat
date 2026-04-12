"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import { getAdminStats, type PlatformStatsDto } from "@/lib/api/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AdminDashboardPage() {
    const router = useRouter();
    const [stats, setStats] = useState<PlatformStatsDto | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const token = getToken();
        if (!token) { router.replace("/login"); return; }
        getAdminStats(token)
            .then(setStats)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load stats"))
            .finally(() => setLoading(false));
    }, [router]);

    if (loading) return <p className="text-muted-foreground text-sm">Loading stats…</p>;
    if (error) return <p className="text-destructive text-sm">{error}</p>;
    if (!stats) return null;

    return (
        <div className="space-y-6 max-w-4xl">
            <h1 className="text-2xl font-bold">Platform Overview</h1>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                            Total Users
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <span className="text-3xl font-bold">{stats.totalUsers}</span>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                            Blocked Users
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <span className="text-3xl font-bold text-destructive">{stats.blockedUsers}</span>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                            Live Sites
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <span className="text-3xl font-bold">{stats.totalLiveDeployments}</span>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">
                            Roles Distribution
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-1">
                        {Object.entries(stats.usersByRole).map(([role, count]) => (
                            <div key={role} className="flex items-center justify-between text-sm">
                                <Badge variant="secondary" className="text-xs">{role}</Badge>
                                <span className="font-medium">{count as number}</span>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
