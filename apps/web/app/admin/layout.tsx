"use client";

/**
 * Superadmin shell (docs/specs/SUPER_ADMIN_SPEC.md, "Information architecture"): five sections for what a local operator
 * does every week — Overview, Users, Projects, Models, Prompts — and everything else, still
 * working, under a collapsible "Advanced" group. A sidebar on desktop, a drawer on mobile.
 */
import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
    ArrowLeft,
    Building2,
    ChevronDown,
    Cpu,
    FolderKanban,
    Image as ImageIcon,
    LayoutDashboard,
    LayoutTemplate,
    Menu,
    MessageSquareCode,
    Palette,
    Send,
    Settings2,
    Users,
    X,
} from "lucide-react";
import { getToken, hasRole } from "@/lib/token-store";
import { VersionBadge } from "@/components/VersionBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
    href: string;
    label: string;
    icon: ComponentType<{ className?: string }>;
    /** Matches only the exact path (the overview would otherwise match every admin page). */
    exact?: boolean;
    /** Older routes that now live inside this item (kept as redirects). */
    aliases?: string[];
}

const PRIMARY: { group: string; items: NavItem[] }[] = [
    {
        group: "Manage",
        items: [
            { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
            { href: "/admin/users", label: "Users", icon: Users },
            { href: "/admin/projects", label: "Projects", icon: FolderKanban },
        ],
    },
    {
        group: "AI",
        items: [
            { href: "/admin/models", label: "Models", icon: Cpu },
            { href: "/admin/prompts", label: "Prompts", icon: MessageSquareCode, aliases: ["/admin/guided-mode", "/admin/governance"] },
        ],
    },
];

const ADVANCED: NavItem[] = [
    { href: "/admin/config", label: "Platform", icon: Settings2 },
    { href: "/admin/publishing", label: "Publishing", icon: Send },
    { href: "/admin/integrations", label: "Media providers", icon: ImageIcon },
    { href: "/admin/presets", label: "Presets", icon: LayoutTemplate },
    { href: "/admin/brand", label: "Brand", icon: Palette },
];

function isActive(pathname: string, item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return [item.href, ...(item.aliases ?? [])].some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
    const active = isActive(pathname, item);
    const Icon = item.icon;
    return (
        <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm no-underline transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                    ? "bg-primary/15 font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
        >
            <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} />
            {item.label}
        </Link>
    );
}

function Sidebar({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
    const advancedActive = ADVANCED.some((item) => isActive(pathname, item));
    const [advancedOpen, setAdvancedOpen] = useState(advancedActive);
    useEffect(() => {
        if (advancedActive) setAdvancedOpen(true);
    }, [advancedActive]);

    return (
        <nav aria-label="Superadmin" className="flex h-full flex-col gap-5 px-3 py-4">
            <div className="flex items-center gap-2 px-2.5">
                <Building2 className="size-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Superadmin</span>
                <VersionBadge className="ml-auto" />
            </div>

            {PRIMARY.map((section) => (
                <div key={section.group} className="flex flex-col gap-0.5">
                    <p className="mb-1 mt-0 px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                        {section.group}
                    </p>
                    {section.items.map((item) => (
                        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                    ))}
                </div>
            ))}

            <div className="flex flex-col gap-0.5">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={advancedOpen}
                    onClick={() => setAdvancedOpen((open) => !open)}
                    className="h-8 justify-between px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 hover:text-foreground"
                >
                    Advanced
                    <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
                </Button>
                {advancedOpen && ADVANCED.map((item) => (
                    <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
                ))}
            </div>

            <div className="mt-auto border-t border-border pt-3">
                <Link
                    href="/dashboard"
                    className="flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground no-underline hover:bg-muted/60 hover:text-foreground"
                >
                    <ArrowLeft className="size-4" />
                    Back to the app
                </Link>
            </div>
        </nav>
    );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const pathname = usePathname() ?? "/admin";
    const [authorized, setAuthorized] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);

    useEffect(() => {
        const token = getToken();
        if (!token || !hasRole("superadmin")) {
            router.replace("/login");
            return;
        }
        setAuthorized(true);
    }, [router]);

    useEffect(() => {
        setDrawerOpen(false);
    }, [pathname]);

    if (!authorized) return null;

    return (
        <div className="min-h-screen bg-background lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* Desktop sidebar */}
            <aside className="sticky top-0 hidden h-screen overflow-y-auto border-r border-border bg-card/60 lg:block">
                <Sidebar pathname={pathname} onNavigate={() => undefined} />
            </aside>

            {/* Mobile top bar + drawer */}
            <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur lg:hidden">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Open the superadmin menu"
                    aria-expanded={drawerOpen}
                    onClick={() => setDrawerOpen(true)}
                >
                    <Menu className="size-5" />
                </Button>
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Superadmin</span>
            </div>
            {drawerOpen && (
                <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Superadmin menu">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
                    <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-border bg-card shadow-2xl">
                        <div className="flex justify-end p-2">
                            <Button type="button" variant="ghost" size="icon" aria-label="Close the menu" onClick={() => setDrawerOpen(false)}>
                                <X className="size-5" />
                            </Button>
                        </div>
                        <Sidebar pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
                    </aside>
                </div>
            )}

            <main className="admin-main min-w-0">
                {children}
            </main>
        </div>
    );
}
