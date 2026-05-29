"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type Capability = "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";

type PickerModel = {
    id: string;
    provider: string;
    role: string;
    capabilities: string[];
    isDefault: boolean;
    isFallback: boolean;
    isActive: boolean;
    displayName?: string;
    description?: string;
    priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
};

type PickerProvider = {
    provider: string;
    isActive: boolean;
    requiresKey?: boolean;
    hasApiKeyConfigured?: boolean;
    models: PickerModel[];
};

interface ProviderModelPickerProps {
    providers: PickerProvider[];
    valueProvider?: string;
    valueModel?: string;
    onChange: (next: { provider: string; model: string }) => void;
    preferredCapability?: Capability;
    includeInactive?: boolean;
    /** When true (default) free-tier models are hidden behind the "Hide free" toggle. */
    defaultHideFree?: boolean;
    disabled?: boolean;
    placeholder?: string;
    searchPlaceholder?: string;
    className?: string;
}

function familyLabel(modelId: string): string {
    const family = modelId.includes("/") ? modelId.split("/")[0] : (modelId.match(/^([a-zA-Z]+)/)?.[1] ?? "other");
    const labels: Record<string, string> = {
        google: "Google",
        anthropic: "Anthropic",
        openai: "OpenAI",
        Qwen: "Qwen / Alibaba",
        "deepseek-ai": "DeepSeek",
        deepseek: "DeepSeek",
        MiniMaxAI: "MiniMax",
        "black-forest-labs": "Black Forest Labs",
        BAAI: "BAAI",
        liquid: "Liquid AI",
        nvidia: "NVIDIA",
        moonshotai: "Moonshot / Kimi",
        "meta-llama": "Meta",
        mistralai: "Mistral",
        microsoft: "Microsoft",
        tencent: "Tencent",
        "ByteDance-Seed": "ByteDance",
        "stepfun-ai": "StepFun",
        baidu: "Baidu",
    };
    return labels[family] ?? family;
}

function modelLabel(model: PickerModel): string {
    return model.displayName?.trim() || model.id;
}

function matchesQuery(provider: PickerProvider, model: PickerModel, query: string): boolean {
    const haystack = [
        provider.provider,
        model.id,
        model.displayName,
        model.description,
        familyLabel(model.id),
        ...model.capabilities,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return haystack.includes(query);
}

function modelWeight(model: PickerModel, preferredCapability?: Capability): number {
    let score = 0;
    if (preferredCapability && model.capabilities.includes(preferredCapability)) score += 10;
    if (model.isDefault) score += 4;
    if (!model.isFallback) score += 2;
    if (model.capabilities.includes("chat")) score += 1;
    return score;
}

function sortModels(models: PickerModel[], preferredCapability?: Capability): PickerModel[] {
    return [...models].sort((left, right) => {
        const weight = modelWeight(right, preferredCapability) - modelWeight(left, preferredCapability);
        if (weight !== 0) return weight;
        return modelLabel(left).localeCompare(modelLabel(right));
    });
}

function groupModels(models: PickerModel[]): Array<{ family: string; models: PickerModel[] }> {
    const groups = new Map<string, PickerModel[]>();
    for (const model of models) {
        const family = familyLabel(model.id);
        const bucket = groups.get(family);
        if (bucket) {
            bucket.push(model);
        } else {
            groups.set(family, [model]);
        }
    }

    return [...groups.entries()].map(([family, group]) => ({ family, models: group }));
}

const CHIP_BASE = "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-wide";

type Chip = { label: string; className: string };

function buildChips(model: PickerModel): Chip[] {
    const chips: Chip[] = [];

    if (model.capabilities.includes("chat")) chips.push({ label: "CHAT", className: cn(CHIP_BASE, "border-primary/40 text-primary") });
    if (model.capabilities.includes("vision")) chips.push({ label: "VISION", className: cn(CHIP_BASE, "border-violet-400/40 text-violet-300") });
    if (model.capabilities.includes("image_generation")) chips.push({ label: "IMAGE", className: cn(CHIP_BASE, "border-emerald-400/40 text-emerald-300") });
    if (model.capabilities.includes("video_generation")) chips.push({ label: "VIDEO", className: cn(CHIP_BASE, "border-amber-400/40 text-amber-300") });
    if (model.capabilities.includes("embeddings")) chips.push({ label: "EMBED", className: cn(CHIP_BASE, "border-border text-muted-foreground") });
    if (model.isDefault) chips.push({ label: "DEFAULT", className: cn(CHIP_BASE, "border-success/50 text-success") });
    if (!model.isActive) chips.push({ label: "OFF", className: cn(CHIP_BASE, "border-destructive/50 text-destructive") });
    if (model.priceTier) chips.push({ label: model.priceTier === "free" ? "FREE" : model.priceTier, className: cn(CHIP_BASE, "border-border text-muted-foreground") });

    return chips.slice(0, 5);
}

export function ProviderModelPicker({
    providers,
    valueProvider,
    valueModel,
    onChange,
    preferredCapability,
    includeInactive = false,
    defaultHideFree = true,
    disabled = false,
    placeholder = "Select provider and model",
    searchPlaceholder = "Search provider or model",
    className,
}: ProviderModelPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [hideFree, setHideFree] = useState(defaultHideFree);
    const [providerScope, setProviderScope] = useState<string>(valueProvider || "all");

    const activeProviders = useMemo(
        () => providers
            .filter((provider) => provider.isActive)
            .map((provider) => ({
                ...provider,
                models: provider.models.filter((model) => includeInactive || model.isActive),
            }))
            .filter((provider) => provider.models.length > 0),
        [includeInactive, providers],
    );

    const selectedProvider = activeProviders.find((provider) => provider.provider === valueProvider) ?? activeProviders[0] ?? null;
    const selectedModel =
        selectedProvider?.models.find((model) => model.id === valueModel)
        ?? selectedProvider?.models.find((model) => model.isDefault)
        ?? selectedProvider?.models[0]
        ?? null;

    const visibleProviders = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const scopedProviders = providerScope !== "all"
            ? activeProviders.filter((provider) => provider.provider === providerScope)
            : activeProviders;

        return scopedProviders
            .map((provider) => {
                let models = normalizedQuery
                    ? provider.models.filter((model) => matchesQuery(provider, model, normalizedQuery))
                    : provider.models;

                // Hide free models only when the provider still offers non-free ones,
                // so a provider is never emptied out by the toggle alone (the selected
                // model is also always kept so the current choice never disappears).
                if (hideFree) {
                    const hasPaid = models.some((model) => model.priceTier !== "free");
                    if (hasPaid) {
                        models = models.filter((model) => model.priceTier !== "free" || model.id === valueModel);
                    }
                }

                return { ...provider, models: sortModels(models, preferredCapability) };
            })
            .filter((provider) => provider.models.length > 0);
    }, [activeProviders, hideFree, preferredCapability, providerScope, query, valueModel]);

    return (
        <div className={cn("w-full", className)}>
            <DropdownMenu
                open={open}
                onOpenChange={(nextOpen) => {
                    setOpen(nextOpen);
                    if (nextOpen) {
                        setProviderScope(valueProvider || "all");
                    } else {
                        setQuery("");
                    }
                }}
            >
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={disabled || activeProviders.length === 0}
                        className="h-auto min-h-10 w-full justify-between gap-3 border-border bg-transparent px-3 py-2 hover:border-primary/60 hover:bg-foreground/[0.04]"
                    >
                        <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                {selectedProvider?.provider ?? "Provider / model"}
                            </div>
                            <div className="truncate text-sm font-medium text-foreground">
                                {selectedModel ? modelLabel(selectedModel) : placeholder}
                            </div>
                        </div>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                    align="start"
                    className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[18rem] border-border bg-popover p-0"
                    onCloseAutoFocus={(event) => event.preventDefault()}
                >
                    <div className="border-b border-border p-2">
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    onKeyDown={(event) => event.stopPropagation()}
                                    placeholder={searchPlaceholder}
                                    className="border-border bg-transparent pl-9"
                                />
                            </div>
                            <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                                <input
                                    type="checkbox"
                                    checked={hideFree}
                                    onChange={(event) => setHideFree(event.target.checked)}
                                    className="h-3.5 w-3.5 accent-primary"
                                />
                                Hide free
                            </label>
                        </div>

                        <ScrollArea className="mt-2 w-full whitespace-nowrap">
                            <div className="flex gap-1 pb-1">
                                <Button
                                    type="button"
                                    variant={providerScope === "all" ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setProviderScope("all")}
                                >
                                    All providers
                                </Button>
                                {activeProviders.map((provider) => (
                                    <Button
                                        key={provider.provider}
                                        type="button"
                                        variant={providerScope === provider.provider ? "secondary" : "ghost"}
                                        size="sm"
                                        onClick={() => setProviderScope(provider.provider)}
                                    >
                                        {provider.provider}
                                    </Button>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>

                    <ScrollArea className="h-[26rem]">
                        {visibleProviders.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">No matching models found.</div>
                        ) : (
                            <div className="p-2">
                                {visibleProviders.map((provider, providerIndex) => (
                                    <div key={provider.provider} className="space-y-1.5">
                                        {providerScope === "all" ? (
                                            <DropdownMenuLabel className="px-2 pb-0 pt-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                                {provider.provider}
                                            </DropdownMenuLabel>
                                        ) : null}

                                        {groupModels(provider.models).map((group) => (
                                            <div key={`${provider.provider}:${group.family}`} className="space-y-0.5">
                                                <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                                                    {group.family}
                                                </div>
                                                {group.models.map((model) => {
                                                    const isSelected = model.provider === selectedProvider?.provider && model.id === selectedModel?.id;
                                                    return (
                                                        <button
                                                            key={`${provider.provider}:${model.id}`}
                                                            type="button"
                                                            onClick={() => {
                                                                onChange({ provider: provider.provider, model: model.id });
                                                                setOpen(false);
                                                            }}
                                                            className={cn(
                                                                "flex w-full items-center gap-2.5 rounded-md border bg-transparent px-2.5 py-1.5 text-left transition-colors",
                                                                isSelected
                                                                    ? "border-primary bg-primary/15 hover:bg-primary/20"
                                                                    : "border-primary/20 hover:border-primary/60 hover:bg-primary/5",
                                                            )}
                                                        >
                                                            <Check className={cn("h-3.5 w-3.5 shrink-0 text-primary", isSelected ? "opacity-100" : "opacity-0")} />
                                                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                                                                {modelLabel(model)}
                                                            </span>
                                                            <span className="flex shrink-0 items-center gap-1">
                                                                {buildChips(model).map((chip) => (
                                                                    <span key={`${model.id}:${chip.label}`} className={chip.className}>
                                                                        {chip.label}
                                                                    </span>
                                                                ))}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))}

                                        {providerIndex < visibleProviders.length - 1 ? <DropdownMenuSeparator /> : null}
                                    </div>
                                ))}
                            </div>
                        )}
                    </ScrollArea>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
