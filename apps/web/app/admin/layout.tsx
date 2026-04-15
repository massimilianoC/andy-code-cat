"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getToken, hasRole } from "@/lib/token-store";

const NAV_LINKS = [
    { href: "/admin", label: "Dashboard", exact: true },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/projects", label: "Projects" },
    { href: "/admin/config", label: "Config" },
    { href: "/admin/presets", label: "Template Models" },
    { href: "/admin/governance", label: "Preprompting" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
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
        <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
            {/* ── Admin navigation bar ───────────────────────────────────── */}
            <header
                style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 20,
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(26,29,39,0.92)",
                    backdropFilter: "blur(14px)",
                    WebkitBackdropFilter: "blur(14px)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "0 1.75rem",
                        height: "44px",
                    }}
                >
                    {/* Brand mark */}
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            marginRight: "16px",
                            flexShrink: 0,
                        }}
                    >
                        <span
                            style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                background: "var(--accent)",
                                boxShadow: "0 0 6px var(--accent)",
                                flexShrink: 0,
                            }}
                        />
                        <span
                            style={{
                                fontSize: "0.7rem",
                                fontWeight: 700,
                                letterSpacing: "0.12em",
                                textTransform: "uppercase",
                                color: "var(--text-muted)",
                            }}
                        >
                            Platform Admin
                        </span>
                    </span>

                    {/* Nav links */}
                    {NAV_LINKS.map(({ href, label, exact }) => {
                        const isActive = exact ? pathname === href : pathname.startsWith(href);
                        return (
                            <a
                                key={href}
                                href={href}
                                style={{
                                    fontSize: "0.8125rem",
                                    fontWeight: isActive ? 600 : 400,
                                    padding: "4px 10px",
                                    borderRadius: "6px",
                                    textDecoration: "none",
                                    transition: "color 0.12s, background 0.12s",
                                    color: isActive ? "var(--text)" : "var(--text-muted)",
                                    background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                                    border: isActive ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                                }}
                                onMouseEnter={(e) => {
                                    if (!isActive) {
                                        (e.currentTarget as HTMLElement).style.color = "var(--text)";
                                        (e.currentTarget as HTMLElement).style.background = "rgba(46,50,72,0.45)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) {
                                        (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                                        (e.currentTarget as HTMLElement).style.background = "transparent";
                                    }
                                }}
                            >
                                {label}
                            </a>
                        );
                    })}

                    {/* Spacer + back link */}
                    <div style={{ marginLeft: "auto" }}>
                        <a
                            href="/dashboard"
                            style={{
                                fontSize: "0.75rem",
                                color: "var(--text-muted)",
                                textDecoration: "none",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                transition: "color 0.12s, background 0.12s",
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLElement).style.color = "var(--text)";
                                (e.currentTarget as HTMLElement).style.background = "rgba(46,50,72,0.45)";
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                                (e.currentTarget as HTMLElement).style.background = "transparent";
                            }}
                        >
                            ← Dashboard
                        </a>
                    </div>
                </div>
            </header>

            {/* ── Page content ───────────────────────────────────────────── */}
            <main className="admin-main">
                {children}
            </main>
        </div>
    );
}
