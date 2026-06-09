"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    listAdminBrandAssets,
    createAdminBrandAssetText,
    uploadAdminBrandAssetFile,
    updateAdminBrandAsset,
    deleteAdminBrandAsset,
    listUserBrandAssets,
    createUserBrandAssetText,
    uploadUserBrandAssetFile,
    updateUserBrandAsset,
    deleteUserBrandAsset,
    listProjectBrandAssets,
    createProjectBrandAssetText,
    updateProjectBrandAsset,
    deleteProjectBrandAsset,
    type BrandAssetDto,
    type CreateBrandTextBody,
} from "@/lib/api/brand";

type Scope = "platform" | "user" | "project";

const ROLE_LABELS: Record<string, string> = {
    brand_logo: "Brand Logo", brand_logo_dark: "Logo (Dark)", brand_logo_light: "Logo (Light)",
    client_logo: "Client Logo", brand_hero: "Hero Image", brand_pattern: "Pattern",
    brand_font_sample: "Font Sample", brand_color_palette: "Color Palette",
    company_name: "Company Name", brand_tagline: "Tagline",
    contact_email: "Email", contact_phone: "Phone", contact_address: "Address",
    social_instagram: "Instagram", social_linkedin: "LinkedIn", social_website: "Website",
    legal_vat: "VAT / Legal", custom: "Custom",
};

const ROLES = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const POLICY_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
    must_use: "default",
    prefer: "secondary",
    optional: "outline",
};

const selectCls =
    "flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background";

interface BrandAssetsManagerProps {
    scope: Scope;
    projectId?: string;
    token: string;
    allowFileUpload?: boolean;
}

export function BrandAssetsManager({ scope, projectId, token, allowFileUpload = true }: BrandAssetsManagerProps) {
    const [assets, setAssets] = useState<BrandAssetDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [form, setForm] = useState<{ role: string; policy: string; valueType: "text" | "color_list" | "url"; textValue: string }>({
        role: "company_name", policy: "prefer", valueType: "text", textValue: "",
    });
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let list: BrandAssetDto[];
            if (scope === "platform") list = await listAdminBrandAssets(token);
            else if (scope === "user") list = await listUserBrandAssets(token);
            else list = await listProjectBrandAssets(token, projectId!);
            setAssets(list);
        } catch {
            setError("Failed to load brand assets.");
        } finally {
            setLoading(false);
        }
    }, [scope, projectId, token]);

    useEffect(() => { load(); }, [load]);

    async function handleAdd() {
        if (!form.textValue.trim()) return;
        setSubmitting(true);
        try {
            const body: CreateBrandTextBody = { ...form };
            let created: BrandAssetDto;
            if (scope === "platform") created = await createAdminBrandAssetText(token, body);
            else if (scope === "user") created = await createUserBrandAssetText(token, body);
            else created = await createProjectBrandAssetText(token, projectId!, body);
            setAssets((prev) => [...prev, created]);
            setForm((f) => ({ ...f, textValue: "" }));
            setAddOpen(false);
        } catch {
            setError("Failed to add brand asset.");
        } finally {
            setSubmitting(false);
        }
    }

    async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            let created: BrandAssetDto;
            const meta = { role: form.role, policy: form.policy };
            if (scope === "platform") created = await uploadAdminBrandAssetFile(token, file, meta);
            else created = await uploadUserBrandAssetFile(token, file, meta);
            setAssets((prev) => [...prev, created]);
        } catch {
            setError("Failed to upload file.");
        } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
        }
    }

    async function handleToggleActive(asset: BrandAssetDto) {
        try {
            let updated: BrandAssetDto;
            const patch = { isActive: !asset.isActive };
            if (scope === "platform") updated = await updateAdminBrandAsset(token, asset.id, patch);
            else if (scope === "user") updated = await updateUserBrandAsset(token, asset.id, patch);
            else updated = await updateProjectBrandAsset(token, projectId!, asset.id, patch);
            setAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        } catch {
            setError("Failed to update asset.");
        }
    }

    async function handleDelete(assetId: string) {
        if (!confirm("Delete this brand asset?")) return;
        try {
            if (scope === "platform") await deleteAdminBrandAsset(token, assetId);
            else if (scope === "user") await deleteUserBrandAsset(token, assetId);
            else await deleteProjectBrandAsset(token, projectId!, assetId);
            setAssets((prev) => prev.filter((a) => a.id !== assetId));
        } catch {
            setError("Failed to delete asset.");
        }
    }

    return (
        <div className="space-y-3">
            {error ? (
                <p className="text-xs text-destructive">{error}</p>
            ) : null}

            {/* Asset list */}
            {loading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
            ) : assets.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No brand assets configured.</p>
            ) : (
                <div className="space-y-1.5">
                    {assets.map((asset) => (
                        <div
                            key={asset.id}
                            className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm"
                            style={{ opacity: asset.isActive ? 1 : 0.45 }}
                        >
                            <span className="w-28 shrink-0 text-xs font-medium text-foreground truncate">
                                {ROLE_LABELS[asset.role] ?? asset.role}
                            </span>
                            <Badge variant={POLICY_VARIANTS[asset.policy] ?? "outline"} className="text-[10px] shrink-0">
                                {asset.policy.replace("_", " ")}
                            </Badge>
                            <span className="flex-1 text-xs text-muted-foreground truncate">
                                {asset.valueType === "asset_ref" ? (asset.originalName ?? "file") : asset.textValue}
                            </span>
                            <button
                                type="button"
                                onClick={() => handleToggleActive(asset)}
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                                title={asset.isActive ? "Disable" : "Enable"}
                            >
                                {asset.isActive ? "ON" : "OFF"}
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDelete(asset.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <Separator />

            {/* Add form toggle */}
            {!addOpen ? (
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setAddOpen(true)}>
                        <Plus className="h-3.5 w-3.5" />
                        Add value
                    </Button>
                    {allowFileUpload && scope !== "project" ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1 text-xs"
                                disabled={uploading}
                                onClick={() => fileRef.current?.click()}
                            >
                                <Upload className="h-3.5 w-3.5" />
                                {uploading ? "Uploading…" : "Upload file"}
                            </Button>
                            <input
                                ref={fileRef}
                                type="file"
                                accept="image/*,application/pdf"
                                className="hidden"
                                onChange={handleFileUpload}
                            />
                        </>
                    ) : null}
                </div>
            ) : (
                <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">
                    <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                            <Label className="text-xs">Role</Label>
                            <select
                                className={selectCls}
                                value={form.role}
                                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                            >
                                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Policy</Label>
                            <select
                                className={selectCls}
                                value={form.policy}
                                onChange={(e) => setForm((f) => ({ ...f, policy: e.target.value as typeof form.policy }))}
                            >
                                <option value="must_use">Must use</option>
                                <option value="prefer">Prefer</option>
                                <option value="optional">Optional</option>
                            </select>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Type</Label>
                            <select
                                className={selectCls}
                                value={form.valueType}
                                onChange={(e) => setForm((f) => ({ ...f, valueType: e.target.value as typeof form.valueType }))}
                            >
                                <option value="text">Text</option>
                                <option value="url">URL</option>
                                <option value="color_list">Colors (hex)</option>
                            </select>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label className="text-xs">
                            {form.valueType === "color_list" ? "Hex values (comma-separated)" : "Value"}
                        </Label>
                        <Input
                            value={form.textValue}
                            onChange={(e) => setForm((f) => ({ ...f, textValue: e.target.value }))}
                            placeholder={form.valueType === "color_list" ? "#FF0000,#00FF00,#0000FF" : form.valueType === "url" ? "https://…" : "Enter value"}
                            className="text-sm"
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" size="sm" className="text-xs" onClick={handleAdd} disabled={submitting || !form.textValue.trim()}>
                            {submitting ? "Saving…" : "Add"}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={() => setAddOpen(false)}>
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
