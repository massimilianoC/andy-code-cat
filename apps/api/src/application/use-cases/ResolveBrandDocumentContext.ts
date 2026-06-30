import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAssetScope, BrandAssetPolicy } from "../../domain/entities/BrandAsset";

export interface ResolvedBrandDocument {
    id: string;
    scope: BrandAssetScope;
    policy: BrandAssetPolicy;
    title: string;
    /** Pre-rendered Layer D fragment, computed once at upload/promote. Injected verbatim. */
    fragment: string;
}

const SCOPE_ORDER: Record<BrandAssetScope, number> = { platform: 0, user: 1, project: 2 };

/**
 * Collects the cached Layer D fragments of all `document_ref` brand assets applicable to a
 * (userId, projectId) context, ordered platform → user → project then by priority.
 *
 * No LLM call, no file I/O — every fragment was already computed once at upload/promote and
 * cached on the BrandAsset. This is the reuse path that lets one brand book inform every project.
 */
export class ResolveBrandDocumentContext {
    constructor(private readonly brandAssetRepository: BrandAssetRepository) {}

    async execute(opts: { userId?: string; projectId?: string }): Promise<ResolvedBrandDocument[]> {
        const assets = await this.brandAssetRepository.resolveForContext(opts);

        return assets
            .filter((a) => a.valueType === "document_ref" && !!a.documentFragment && a.documentFragment.trim().length > 0)
            .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.priority - b.priority)
            .map((a) => ({
                id: a.id,
                scope: a.scope,
                policy: a.policy,
                title: a.originalName ?? a.description ?? "Brand document",
                fragment: a.documentFragment!,
            }));
    }
}
