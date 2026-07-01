import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAsset, BrandAssetScope, BrandAssetPolicy } from "../../domain/entities/BrandAsset";

export interface ResolvedBrandDocument {
    id: string;
    scope: BrandAssetScope;
    policy: BrandAssetPolicy;
    title: string;
    /** Pre-rendered Layer D fragment, computed once at upload/promote. Injected verbatim. */
    fragment: string;
}

const SCOPE_ORDER: Record<BrandAssetScope, number> = { platform: 0, user: 1, project: 2 };

/** Poll cadence while waiting for an in-flight brand-document analysis. */
const PENDING_POLL_INTERVAL_MS = 1_500;

/**
 * A `pending` analysis older than this will never complete (e.g. the API restarted while the
 * background enrichment was running). It is marked `failed` on read so the UI stops showing
 * an infinite spinner and consumers stop waiting for it.
 */
export const BRAND_DOC_STALE_PENDING_MS = 10 * 60_000;

/**
 * Default bounded wait used by prompt-composition consumers (generation, prefill).
 * The enrichment content is functional to the next operational step, so those steps MUST
 * wait for in-flight analyses to complete (never treat them as fire-and-forget). The wait is
 * bounded so a hung analysis cannot hang the request forever — the stale guard converts it
 * to `failed` and the composition proceeds without the document.
 */
export const BRAND_DOC_WAIT_FOR_PENDING_MS = 120_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collects the cached Layer D fragments of all `document_ref` brand assets applicable to a
 * (userId, projectId) context, ordered platform → user → project then by priority.
 *
 * No LLM call, no file I/O — every fragment was already computed once at upload/promote and
 * cached on the BrandAsset. This is the reuse path that lets one brand book inform every project.
 *
 * When `waitForPendingMs > 0`, documents whose analysis is still `pending` are awaited (DB
 * polling, bounded) so the returned context is complete before it is used downstream.
 */
export class ResolveBrandDocumentContext {
    constructor(private readonly brandAssetRepository: BrandAssetRepository) {}

    async execute(opts: {
        userId?: string;
        projectId?: string;
        /** Max time to wait for in-flight (pending) analyses. 0/absent = no wait (fast read). */
        waitForPendingMs?: number;
    }): Promise<ResolvedBrandDocument[]> {
        const deadline = Date.now() + Math.max(0, opts.waitForPendingMs ?? 0);

        for (;;) {
            const assets = await this.brandAssetRepository.resolveForContext({
                userId: opts.userId,
                projectId: opts.projectId,
            });
            const docs = assets.filter((a) => a.valueType === "document_ref");

            const pending = await this.failStaleAndListPending(docs);
            if (pending.length === 0 || Date.now() >= deadline) {
                return toResolvedDocuments(docs);
            }
            await sleep(Math.min(PENDING_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
        }
    }

    /** Marks stale pending analyses as failed; returns the still-live pending ones. */
    private async failStaleAndListPending(docs: BrandAsset[]): Promise<BrandAsset[]> {
        const now = Date.now();
        const isPending = (a: BrandAsset) => (a.enrichmentStatus ?? (a.documentFragment ? "ready" : "pending")) === "pending";
        const stale = docs.filter((a) => isPending(a) && now - a.updatedAt.getTime() > BRAND_DOC_STALE_PENDING_MS);
        if (stale.length > 0) {
            await Promise.allSettled(
                stale.map((a) => this.brandAssetRepository.update(a.id, { enrichmentStatus: "failed" })),
            );
        }
        const staleIds = new Set(stale.map((a) => a.id));
        return docs.filter((a) => isPending(a) && !staleIds.has(a.id));
    }
}

function toResolvedDocuments(docs: BrandAsset[]): ResolvedBrandDocument[] {
    return docs
        .filter((a) => !!a.documentFragment && a.documentFragment.trim().length > 0)
        .sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.priority - b.priority)
        .map((a) => ({
            id: a.id,
            scope: a.scope,
            policy: a.policy,
            title: a.originalName ?? a.description ?? "Brand document",
            fragment: a.documentFragment!,
        }));
}
