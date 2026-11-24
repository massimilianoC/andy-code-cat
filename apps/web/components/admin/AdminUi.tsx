"use client";

/**
 * The superadmin's shared building blocks: one page header, one tab strip (accessible, kept in
 * the URL so a section can be linked and survives a reload), one way to say "this setting is not
 * enforced yet". Every admin page uses these instead of its own copy, so the sections look and
 * behave the same (docs/specs/SUPER_ADMIN_SPEC.md, "Information architecture").
 */
import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function AdminPageHeader({
    title,
    description,
    actions,
    eyebrow,
}: {
    title: string;
    description?: ReactNode;
    actions?: ReactNode;
    /** Small label above the title, e.g. the section group. */
    eyebrow?: string;
}) {
    return (
        <header className="mb-6 flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
                {eyebrow && (
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{eyebrow}</p>
                )}
                <h1 className="m-0 text-2xl font-bold text-foreground">{title}</h1>
                {description && <p className="mt-1.5 mb-0 max-w-3xl text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
    );
}

export interface AdminTab<T extends string> {
    id: T;
    label: string;
    /** Shown as a small counter or marker next to the label. */
    badge?: ReactNode;
}

/**
 * Tabs with the WAI-ARIA tablist pattern: arrow keys move between tabs, the panel is labelled
 * by its tab. Controlled — pair it with `useTabParam` to keep the choice in the URL.
 */
export function AdminTabs<T extends string>({
    tabs,
    value,
    onChange,
    className,
}: {
    tabs: AdminTab<T>[];
    value: T;
    onChange: (next: T) => void;
    className?: string;
}) {
    const baseId = useId();
    const refs = useRef<Array<HTMLButtonElement | null>>([]);

    function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
        const last = tabs.length - 1;
        const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
            : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
                : event.key === "Home" ? 0
                    : event.key === "End" ? last
                        : null;
        if (next === null) return;
        event.preventDefault();
        refs.current[next]?.focus();
        onChange(tabs[next]!.id);
    }

    return (
        <div
            role="tablist"
            aria-orientation="horizontal"
            className={cn("mb-6 flex gap-1 overflow-x-auto border-b border-border", className)}
        >
            {tabs.map((tab, index) => {
                const selected = tab.id === value;
                return (
                    // A tab is a native button by the WAI-ARIA pattern; the shared Button primitive
                    // carries variant chrome that a tab strip must not have.
                    <button
                        key={tab.id}
                        ref={(element) => { refs.current[index] = element; }}
                        id={`${baseId}-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        aria-controls={`${baseId}-panel-${tab.id}`}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(tab.id)}
                        onKeyDown={(event) => onKeyDown(event, index)}
                        className={cn(
                            "-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-0 border-b-2 bg-transparent px-3 py-2.5 text-sm font-medium transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {tab.label}
                        {tab.badge}
                    </button>
                );
            })}
        </div>
    );
}

/** The selected tab, kept in `?tab=` (replace, not push: switching tabs is not navigation). */
export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (next: T) => void] {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const raw = searchParams?.get("tab");
    const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
    const setValue = useCallback((next: T) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        if (next === fallback) params.delete("tab");
        else params.set("tab", next);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [fallback, pathname, router, searchParams]);
    return [value, setValue];
}

/**
 * A setting that is stored but that no code path applies yet. Shown, so nobody is surprised by
 * a value they cannot find, but disabled, so nobody believes it protects anything.
 */
export function NotEnforcedNotice({ children, label = "Not enforced" }: { children: ReactNode; label?: string }) {
    return (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <div>
                <Badge variant="outline" className="mr-2 text-[10px] uppercase tracking-wide">{label}</Badge>
                {children}
            </div>
        </div>
    );
}
