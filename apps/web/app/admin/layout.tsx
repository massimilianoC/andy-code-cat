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
            <nav className="sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-1 sm:gap-3 flex-wrap">
                <span className="font-semibold text-sm text-primary mr-2 shrink-0">Platform Admin</span>
                {[
                    { href: "/admin", label: "Dashboard" },
                    { href: "/admin/users", label: "Users" },
                    { href: "/admin/projects", label: "Projects" },
                    { href: "/admin/config", label: "Config" },
                    { href: "/admin/governance", label: "Governance" },
                ].map(({ href, label }) => (
                    <a
                        key={href}
                        href={href}
                        className="text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors px-3 py-1.5 rounded-md"
                    >
                        {label}
                    </a>
                ))}
                <div className="ml-auto">
                    <a href="/dashboard" className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-muted/50">
                        ← Back to Dashboard
                    </a>
                </div>
            </nav>
            <main className="admin-main px-4 sm:px-6 lg:px-8 xl:px-12 py-6">
                {children}
            </main>
        </div>
    );
}
