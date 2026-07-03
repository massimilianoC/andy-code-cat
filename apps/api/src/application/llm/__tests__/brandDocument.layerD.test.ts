import { describe, it, expect, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        enrichmentInjectLayerD: true,
        ENRICHMENT_LAYER_D_MAX_CHARS: 50_000,
        ENRICHMENT_LAYER_D_MAX_ASSETS: 10,
    },
}));

import { buildBrandDocumentLayerD } from "../systemPromptLayers";
import { ResolveBrandDocumentContext } from "../../use-cases/ResolveBrandDocumentContext";
import type { ResolvedBrandDocument } from "../../use-cases/ResolveBrandDocumentContext";
import type { BrandAsset } from "../../../domain/entities/BrandAsset";
import type { BrandAssetRepository } from "../../../domain/repositories/BrandAssetRepository";

function makeBrandDoc(over: Partial<ResolvedBrandDocument>): ResolvedBrandDocument {
    return {
        id: "bd-1",
        scope: "user",
        policy: "prefer",
        title: "Brand Book.pdf",
        fragment: "Asset: Brand Book\nType: pdf\nSummary: tone of voice is warm and direct.",
        ...over,
    };
}

describe("buildBrandDocumentLayerD", () => {
    it("returns empty string when there are no brand documents (Layer D unchanged)", () => {
        expect(buildBrandDocumentLayerD([])).toBe("");
    });

    it("renders a BRAND REFERENCE MATERIALS block with scope/policy labels and the cached fragment", () => {
        const out = buildBrandDocumentLayerD([
            makeBrandDoc({ scope: "platform", policy: "must_use", title: "Group Guidelines" }),
        ]);
        expect(out).toContain("## LAYER D — BRAND REFERENCE MATERIALS");
        expect(out).toContain("[MUST USE / Platform] Group Guidelines");
        expect(out).toContain("tone of voice is warm and direct");
    });

    it("drops whole fragments that exceed the char budget (never mid-fragment)", () => {
        const big = makeBrandDoc({ id: "big", fragment: "X".repeat(500) });
        const small = makeBrandDoc({ id: "small", title: "Tiny", fragment: "short" });
        const out = buildBrandDocumentLayerD([big, small], { maxChars: 300 });
        // Budget too small for the big fragment + header → nothing fits → empty
        expect(out).toBe("");
    });
});

describe("ResolveBrandDocumentContext", () => {
    function fakeRepo(assets: BrandAsset[]): BrandAssetRepository {
        return {
            resolveForContext: async () => assets,
        } as unknown as BrandAssetRepository;
    }

    function makeAsset(over: Partial<BrandAsset>): BrandAsset {
        return {
            id: "a", scope: "user", role: "brand_document", policy: "prefer",
            valueType: "document_ref", isActive: true, priority: 0,
            originalName: "doc.pdf", documentFragment: "fragment text",
            createdAt: new Date(), updatedAt: new Date(),
            ...over,
        } as BrandAsset;
    }

    it("returns only document_ref assets that carry a non-empty fragment", async () => {
        const repo = fakeRepo([
            makeAsset({ id: "ok", documentFragment: "good fragment" }),
            makeAsset({ id: "no-fragment", documentFragment: "" }),
            makeAsset({ id: "atom", valueType: "text", documentFragment: undefined }),
        ]);
        const result = await new ResolveBrandDocumentContext(repo).execute({ userId: "u", projectId: "p" });
        expect(result.map((r) => r.id)).toEqual(["ok"]);
    });

    it("orders platform → user → project then by priority", async () => {
        const repo = fakeRepo([
            makeAsset({ id: "proj", scope: "project", priority: 0 }),
            makeAsset({ id: "user2", scope: "user", priority: 5 }),
            makeAsset({ id: "user1", scope: "user", priority: 1 }),
            makeAsset({ id: "plat", scope: "platform", priority: 9 }),
        ]);
        const result = await new ResolveBrandDocumentContext(repo).execute({ userId: "u", projectId: "p" });
        expect(result.map((r) => r.id)).toEqual(["plat", "user1", "user2", "proj"]);
    });
});
