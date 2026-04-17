"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { AiUsageAnalyticsDto, ProjectAssetDto, SuggestProjectImageIdeaResult } from "@/lib/api/assets";
import type { LlmFocusContext } from "@/lib/api/llm";
import { downloadProjectAssetDataUrl } from "@/lib/api/assets";

interface MediaInspectorPanelProps {
    token: string;
    projectId: string;
    selectedElement: NonNullable<LlmFocusContext["selectedElement"]>;
    assets: ProjectAssetDto[];
    loadingAssets: boolean;
    chatPromptPlaceholder: string;
    chatPromptReady: boolean;
    assetScope: "project" | "user";
    onAssetScopeChange: (value: "project" | "user") => void;
    mediaMode: "foreground" | "background";
    onMediaModeChange: (value: "foreground" | "background") => void;
    backgroundFit: "cover" | "contain" | "auto";
    onBackgroundFitChange: (value: "cover" | "contain" | "auto") => void;
    backgroundRepeat: "no-repeat" | "repeat" | "repeat-x" | "repeat-y";
    onBackgroundRepeatChange: (value: "no-repeat" | "repeat" | "repeat-x" | "repeat-y") => void;
    mediaOpacity: number;
    onMediaOpacityChange: (value: number) => void;
    mediaFilter: string;
    onMediaFilterChange: (value: string) => void;
    generating: boolean;
    suggesting: boolean;
    suggestion: SuggestProjectImageIdeaResult | null;
    imageModelOptions: Array<{ id: string; label: string; provider: string; providerLabel: string }>;
    selectedImageModel: string;
    onImageModelChange: (value: string) => void;
    imageSize: string;
    onImageSizeChange: (value: string) => void;
    imageSteps: number;
    onImageStepsChange: (value: number) => void;
    aiAnalytics: AiUsageAnalyticsDto | null;
    loadingAiAnalytics: boolean;
    onGenerate: () => void;
    onSuggest: () => void;
    onUseSuggestion: () => void;
    onOpenGallery: () => void;
    onApplyAsset: (asset: ProjectAssetDto) => void;
    onApplyCurrentStyles: () => void;
}

export default function MediaInspectorPanel(props: MediaInspectorPanelProps) {
    const previewUrl = props.selectedElement.currentSrc || props.selectedElement.backgroundImageUrl;
    const recentAssets = props.assets.slice(0, 4);
    const recentAssetKey = recentAssets.map((asset) => asset.id).join("|");
    const [assetPreviewUrls, setAssetPreviewUrls] = useState<Record<string, string>>({});

    useEffect(() => {
        let disposed = false;

        async function loadThumbs() {
            const entries = await Promise.all(
                recentAssets.map(async (asset) => {
                    if (!asset.mimeType.startsWith("image/")) return [asset.id, ""] as const;
                    try {
                        const url = await downloadProjectAssetDataUrl(props.token, props.projectId, asset.id);
                        return [asset.id, url] as const;
                    } catch {
                        return [asset.id, ""] as const;
                    }
                })
            );

            if (!disposed) {
                setAssetPreviewUrls(Object.fromEntries(entries));
            }
        }

        void loadThumbs();
        return () => {
            disposed = true;
        };
    }, [recentAssetKey, props.projectId, props.token]);

    return (
        <div className="mt-2 rounded-lg border border-border bg-card/60 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-foreground">Media</p>
                    <p className="truncate text-[11px] text-muted-foreground">{props.selectedElement.selector}</p>
                </div>
                <div className="flex items-center gap-1.5">
                    {previewUrl ? <Badge variant="outline" className="text-[9px] uppercase">linked</Badge> : null}
                    <Badge variant="secondary" className="text-[9px] uppercase">
                        {props.mediaMode === "foreground" ? "replace" : "bg"}
                    </Badge>
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={props.mediaMode === "foreground" ? "default" : "outline"}
                    onClick={() => props.onMediaModeChange("foreground")}
                >
                    Replace image
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={props.mediaMode === "background" ? "default" : "outline"}
                    onClick={() => props.onMediaModeChange("background")}
                >
                    Set background
                </Button>
            </div>

            <details className="rounded-md border border-border bg-background/30">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground">
                    Gen image
                </summary>
                <div className="space-y-2 border-t border-border px-3 py-3">
                    <p className="text-xs italic text-muted-foreground">{props.chatPromptPlaceholder}</p>
                    {!props.chatPromptReady ? (
                        <p className="text-[11px] text-muted-foreground">
                            If you are unsure, ask for a suggestion first.
                        </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={props.onSuggest} disabled={props.suggesting}>
                            {props.suggesting ? "Suggesting..." : "Suggest idea"}
                        </Button>
                        <Button type="button" onClick={props.onGenerate} disabled={props.generating || !props.chatPromptReady}>
                            {props.generating ? "Generating..." : "Generate from chat prompt"}
                        </Button>
                    </div>
                    {props.suggestion ? (
                        <div className="space-y-2 rounded-md border border-border bg-background/60 p-2">
                            <p className="text-[11px] font-medium text-foreground">Suggested direction</p>
                            <p className="text-xs text-muted-foreground">{props.suggestion.suggestion}</p>
                            <div className="rounded bg-muted/20 p-2 text-[11px] text-foreground break-words">
                                {props.suggestion.suggestedPrompt}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={props.onUseSuggestion}>
                                    Use as prompt
                                </Button>
                                <Badge variant="outline" className="text-[10px]">
                                    {props.suggestion.provider} · {props.suggestion.model}
                                </Badge>
                            </div>
                        </div>
                    ) : null}
                </div>
            </details>

            <details className="rounded-md border border-border bg-background/30">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground">
                    Gallery / upload
                </summary>
                <div className="space-y-3 border-t border-border px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="secondary" onClick={props.onOpenGallery}>
                            Open gallery
                        </Button>
                        <Button type="button" variant="outline" onClick={props.onApplyCurrentStyles}>
                            Apply style
                        </Button>
                    </div>

                    {props.loadingAssets ? (
                        <p className="text-xs text-muted-foreground">Loading assets…</p>
                    ) : recentAssets.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No recent assets yet.</p>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {recentAssets.map((asset) => {
                                const previewAssetUrl = assetPreviewUrls[asset.id];
                                const isImage = asset.mimeType.startsWith("image/");
                                return (
                                    <div key={asset.id} className="rounded-md border border-border bg-background/60 p-2 space-y-2">
                                        <div className="aspect-square overflow-hidden rounded bg-muted/20 flex items-center justify-center">
                                            {isImage && previewAssetUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img src={previewAssetUrl} alt={asset.label ?? asset.originalName} className="h-full w-full object-cover" />
                                            ) : (
                                                <span className="px-2 text-center text-[10px] text-muted-foreground">{asset.label ?? asset.originalName}</span>
                                            )}
                                        </div>
                                        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => props.onApplyAsset(asset)}>
                                            Use
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </details>

            <details className="rounded-md border border-border bg-background/30">
                <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-foreground">
                    Advanced
                </summary>
                <div className="space-y-3 border-t border-border px-3 py-3">
                    <div className="space-y-1.5">
                        <Label>Save generated media to</Label>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant={props.assetScope === "project" ? "default" : "outline"}
                                size="sm"
                                onClick={() => props.onAssetScopeChange("project")}
                            >
                                This project
                            </Button>
                            <Button
                                type="button"
                                variant={props.assetScope === "user" ? "default" : "outline"}
                                size="sm"
                                onClick={() => props.onAssetScopeChange("user")}
                            >
                                My library
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label>Model</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={props.selectedImageModel}
                                onChange={(e) => props.onImageModelChange(e.target.value)}
                            >
                                {props.imageModelOptions.length === 0 ? (
                                    <option value="">No image model available</option>
                                ) : (
                                    (() => {
                                        const groups = new Map<string, typeof props.imageModelOptions>();
                                        for (const opt of props.imageModelOptions) {
                                            const list = groups.get(opt.provider) ?? [];
                                            list.push(opt);
                                            groups.set(opt.provider, list);
                                        }
                                        return Array.from(groups.entries()).map(([provider, models]) => (
                                            <optgroup key={provider} label={models[0].providerLabel}>
                                                {models.map((model) => (
                                                    <option key={model.id} value={model.id}>{model.label}</option>
                                                ))}
                                            </optgroup>
                                        ));
                                    })()
                                )}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Size</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={props.imageSize}
                                onChange={(e) => props.onImageSizeChange(e.target.value)}
                            >
                                <option value="512x512">512 × 512</option>
                                <option value="768x768">768 × 768</option>
                                <option value="1024x1024">1024 × 1024</option>
                                <option value="1280x720">1280 × 720</option>
                                <option value="720x1280">720 × 1280</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Steps</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={String(props.imageSteps)}
                                onChange={(e) => props.onImageStepsChange(Number(e.target.value))}
                            >
                                <option value="4">4 · fast</option>
                                <option value="8">8 · balanced</option>
                                <option value="12">12 · detail</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Fit</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={props.backgroundFit}
                                onChange={(e) => props.onBackgroundFitChange(e.target.value as "cover" | "contain" | "auto")}
                            >
                                <option value="cover">cover</option>
                                <option value="contain">contain</option>
                                <option value="auto">auto</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Repeat</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={props.backgroundRepeat}
                                onChange={(e) => props.onBackgroundRepeatChange(e.target.value as "no-repeat" | "repeat" | "repeat-x" | "repeat-y")}
                            >
                                <option value="no-repeat">no-repeat</option>
                                <option value="repeat">repeat</option>
                                <option value="repeat-x">repeat-x</option>
                                <option value="repeat-y">repeat-y</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Filter</Label>
                            <select
                                className="flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground"
                                value={props.mediaFilter}
                                onChange={(e) => props.onMediaFilterChange(e.target.value)}
                            >
                                <option value="none">none</option>
                                <option value="grayscale(100%)">grayscale</option>
                                <option value="sepia(50%)">sepia</option>
                                <option value="contrast(1.1) saturate(1.1)">contrast</option>
                                <option value="blur(1px)">soft blur</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Opacity</Label>
                            <Input
                                type="range"
                                min="0.1"
                                max="1"
                                step="0.05"
                                value={props.mediaOpacity}
                                onChange={(e) => props.onMediaOpacityChange(Number(e.target.value))}
                            />
                        </div>
                    </div>
                </div>
            </details>
        </div>
    );
}
