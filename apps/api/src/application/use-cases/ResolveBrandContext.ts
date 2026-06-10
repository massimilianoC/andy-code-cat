import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAsset, BrandAssetScope, BrandAssetPolicy, BrandAssetRole } from "../../domain/entities/BrandAsset";

export interface ResolvedBrandEntry {
    id: string;
    scope: BrandAssetScope;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    valueType: BrandAsset["valueType"];
    displayValue: string;
    originalName?: string;
    description?: string;
}

export interface ResolvedBrandContext {
    entries: ResolvedBrandEntry[];
    hasMustUse: boolean;
}

const SCOPE_ORDER: Record<BrandAssetScope, number> = { platform: 0, user: 1, project: 2 };

export class ResolveBrandContext {
    constructor(private readonly brandAssetRepository: BrandAssetRepository) {}

    async execute(
        opts: { userId?: string; projectId?: string },
        baseUrl?: string,
    ): Promise<ResolvedBrandContext> {
        const assets = await this.brandAssetRepository.resolveForContext(opts);

        const entries: ResolvedBrandEntry[] = assets
            .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.priority - b.priority)
            .map((asset) => {
                let displayValue = "";
                if (asset.valueType === "asset_ref") {
                    displayValue = buildDownloadUrl(asset, baseUrl);
                } else {
                    displayValue = asset.textValue ?? "";
                }
                return {
                    id: asset.id,
                    scope: asset.scope,
                    role: asset.role,
                    customRoleLabel: asset.customRoleLabel,
                    policy: asset.policy,
                    valueType: asset.valueType,
                    displayValue,
                    originalName: asset.originalName,
                    description: asset.description,
                };
            });

        return {
            entries,
            hasMustUse: entries.some((e) => e.policy === "must_use"),
        };
    }
}

function buildDownloadUrl(asset: BrandAsset, baseUrl?: string): string {
    const prefix = baseUrl?.replace(/\/$/, "") ?? "";
    if (asset.scope === "platform") return `${prefix}/v1/admin/brand-assets/${asset.id}/download`;
    if (asset.scope === "user") return `${prefix}/v1/users/me/brand-assets/${asset.id}/download`;
    return `${prefix}/v1/projects/${asset.projectId}/brand-assets/${asset.id}/download`;
}
