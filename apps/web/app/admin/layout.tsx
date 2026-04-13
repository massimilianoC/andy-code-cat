"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken, hasRole } from "@/lib/token-store";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [authorized, setAuthorized] = useState(false);

    useEffect(() => {
        const token = getToken();
        if (!token || !hasRole("superadmin")) {
            router.replace("/login");
            return;
        }
        setAuthorized(true);
    }, [router]);

    if (!authorized) return null;

    return (
        <div className="min-h-screen bg-background text-foreground">
            <nav className="border-b border-border bg-card px-6 py-3 flex items-center gap-6">
                <span className="font-semibold text-sm text-primary">Platform Admin</span>
                <a href="/admin" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Dashboard
                </a>
                <a href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Users
                </a>
                <a href="/admin/projects" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Projects
                </a>
                <a href="/admin/config" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Config
                </a>
                <a href="/admin/governance" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Governance
                </a>
                <div className="ml-auto">
                    <a href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                        ← Back to Dashboard
                    </a>
                </div>
            </nav>
            <main className="p-6">
                {children}
            </main>
        </div>
    );
}
