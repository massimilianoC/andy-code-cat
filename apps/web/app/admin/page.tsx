"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/token-store";
import { getAdminStats, type PlatformStatsDto } from "@/lib/api/admin";

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    sub,
    accentColor,
    href,
}: {
    label: string;
    value: string | number;
    sub?: string;
    accentColor?: string;
    href?: string;
}) {
    const inner = (
        <div
            style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "1rem 1.25rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.35rem",
                borderLeft: accentColor ? `3px solid ${accentColor}` : undefined,
                transition: "border-color 0.15s",
                cursor: href ? "pointer" : undefined,
            }}
        >
            <span
                style={{
                    fontSize: "0.67rem",
                    fontWeight: 600,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: "1.75rem",
                    fontWeight: 700,
                    lineHeight: 1.15,
                    color: accentColor ?? "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {value}
            </span>
            {sub && (
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{sub}</span>
            )}
        </div>
    );

    if (href) {
        return (
            <a href={href} style={{ textDecoration: "none" }}>
                {inner}
            </a>
        );
    }
    return inner;
}

// ── Quick-action link ──────────────────────────────────────────────────────────

function QuickLink({ href, label, description }: { href: string; label: string; description: string }) {
    return (
        <a
            href={href}
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "3px",
                padding: "0.9rem 1.1rem",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "9px",
                textDecoration: "none",
                transition: "border-color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.4)";
                (e.currentTarget as HTMLElement).style.background = "rgba(26,29,39,0.9)";
            }}
            onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.background = "var(--surface)";
            }}
        >
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text)" }}>{label}</span>
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{description}</span>
        </a>
    );
}

// ── Page ───────────────────────────────────────────────────────────────────────

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

    if (loading) {
        return (
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>Loading stats…</p>
        );
    }

    if (error) {
        return (
            <div style={{ padding: "0.75rem 1rem", borderRadius: "8px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", fontSize: "0.8125rem", color: "var(--danger)" }}>
                {error}
            </div>
        );
    }

    if (!stats) return null;

    const tokenK = ((stats.totalTokensConsumedLifetime ?? 0) / 1000).toFixed(1);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "2rem", maxWidth: "1400px" }}>
            {/* ── Header ───────────────────────────────────────────────────── */}
            <div>
                <h1 style={{ fontSize: "1.375rem", fontWeight: 700, color: "var(--text)", marginBottom: "0.25rem" }}>
                    Platform Overview
                </h1>
                <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)" }}>
                    Live stats across users, projects, deployments, and token consumption.
                </p>
            </div>

            {/* ── Stats grid ───────────────────────────────────────────────── */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: "12px",
                }}
            >
                <StatCard
                    label="Total Users"
                    value={stats.totalUsers}
                    href="/admin/users"
                    accentColor="var(--accent)"
                />
                <StatCard
                    label="Blocked Users"
                    value={stats.blockedUsers}
                    accentColor={stats.blockedUsers > 0 ? "var(--danger)" : "var(--border)"}
                    sub={stats.blockedUsers > 0 ? "requires attention" : "all clear"}
                    href="/admin/users"
                />
                <StatCard
                    label="Total Projects"
                    value={stats.totalProjects ?? 0}
                    href="/admin/projects"
                    accentColor="var(--accent)"
                />
                <StatCard
                    label="Live Deployments"
                    value={stats.totalLiveDeployments}
                    accentColor="var(--success)"
                    sub="published sites"
                    href="/admin/projects"
                />
                <StatCard
                    label="Tokens Lifetime"
                    value={`${tokenK}K`}
                    accentColor="#818cf8"
                    sub="all users combined"
                />
            </div>

            {/* ── Roles breakdown ──────────────────────────────────────────── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h2 style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Roles distribution
                </h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {Object.entries(stats.usersByRole).map(([role, count]) => (
                        <div
                            key={role}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                padding: "6px 12px",
                                borderRadius: "7px",
                                background: "var(--surface)",
                                border: "1px solid var(--border)",
                                fontSize: "0.8125rem",
                            }}
                        >
                            <span
                                style={{
                                    padding: "1px 7px",
                                    borderRadius: "999px",
                                    fontSize: "0.7rem",
                                    fontWeight: 600,
                                    background: role === "superadmin" ? "rgba(99,102,241,0.15)" : "rgba(46,50,72,0.8)",
                                    color: role === "superadmin" ? "var(--accent-hover)" : "var(--text-muted)",
                                    border: role === "superadmin" ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
                                }}
                            >
                                {role}
                            </span>
                            <span style={{ fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                                {count as number}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Quick links ──────────────────────────────────────────────── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                <h2 style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                    Quick access
                </h2>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                        gap: "10px",
                    }}
                >
                    <QuickLink href="/admin/users" label="Users" description="Manage accounts, roles, and limits" />
                    <QuickLink href="/admin/projects" label="Projects" description="All projects across all users" />
                    <QuickLink href="/admin/config" label="Config" description="Registration, verification, defaults" />
                    <QuickLink href="/admin/governance" label="Governance" description="Prompts, injections, runtime, legal" />
                </div>
            </div>
        </div>
    );
}
