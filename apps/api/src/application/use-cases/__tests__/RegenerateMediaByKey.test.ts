import { describe, expect, it, vi } from "vitest";
import { RegenerateMediaByKey } from "../RegenerateMediaByKey";

const baseTrace = {
    id: "trace-1",
    projectId: "project-1",
    userId: "user-1",
    snapshotId: "snapshot-1",
    conversationId: "conversation-1",
    mediaKey: "hero-main",
    request: {
        key: "hero-main",
        kind: "background",
        role: "hero",
        sourceStrategy: "stock",
        semanticQuery: "modern architecture studio",
        alt: "Modern architecture studio",
        width: 1600,
        height: 900,
    },
    resolvedAssetId: "asset-old",
    strategy: "stock",
    providerKind: "stock",
    requestedProvider: "pexels",
    finalProvider: "pexels",
    fallbackUsed: false,
    attemptedProviders: [{ provider: "pexels", status: "success" as const }],
    status: "resolved",
    sourceContext: { route: "chat-preview", selectedElementSelector: "[data-media-key=hero-main]" },
    createdAt: new Date("2026-05-29T00:00:00.000Z"),
};

describe("RegenerateMediaByKey", () => {
    it("regenerates from the latest media trace and persists a new trace", async () => {
        const traceRepository = {
            findLatestByMediaKey: vi.fn(async () => baseTrace),
            createMany: vi.fn(async (input: any[]) => input.map((trace, index) => ({
                id: `trace-new-${index + 1}`,
                createdAt: new Date("2026-05-29T01:00:00.000Z"),
                ...trace,
            }))),
            attachSnapshot: vi.fn(),
        };
        const stockRegenerator = {
            execute: vi.fn(async () => ({
                asset: {
                    id: "asset-new",
                    projectId: "project-1",
                    userId: "user-1",
                    scope: "project" as const,
                    originalName: "stock-image.jpg",
                    storedFilename: "asset-new-stock-image.jpg",
                    mimeType: "image/jpeg",
                    fileSize: 1234,
                    source: "platform_generated" as const,
                    createdAt: new Date("2026-05-29T01:00:00.000Z"),
                },
                assetUrl: "http://localhost:4000/p/media/asset-new",
                provider: "pexels",
                fallbackUsed: false,
                attribution: "Pexels",
                attemptedProviders: [{ provider: "pexels", status: "success" as const }],
            })),
        };

        const useCase = new RegenerateMediaByKey(traceRepository as any, stockRegenerator);
        const result = await useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            mediaKey: "hero-main",
            snapshotId: "snapshot-1",
            offset: 2,
            width: 1200,
            targetMode: "background",
        });

        expect(traceRepository.findLatestByMediaKey).toHaveBeenCalledWith({
            projectId: "project-1",
            userId: "user-1",
            mediaKey: "hero-main",
            snapshotId: "snapshot-1",
        });
        expect(stockRegenerator.execute).toHaveBeenCalledWith(expect.objectContaining({
            query: "modern architecture studio",
            width: 1200,
            height: 900,
            offset: 2,
            suppressNotifications: true,
            allowFallback: false,
        }));
        expect(traceRepository.createMany).toHaveBeenCalledWith([expect.objectContaining({
            mediaKey: "hero-main",
            resolvedAssetId: "asset-new",
            fallbackUsed: false,
            status: "resolved",
            parentSnapshotId: "snapshot-1",
        })]);
        expect(result.traceId).toBe("trace-new-1");
        expect(result.assetUrl).toBe("http://localhost:4000/p/media/asset-new");
    });

    it("fails clearly when no trace exists for the media key", async () => {
        const useCase = new RegenerateMediaByKey({
            findLatestByMediaKey: vi.fn(async () => null),
            createMany: vi.fn(),
            attachSnapshot: vi.fn(),
        } as any, { execute: vi.fn() });

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            mediaKey: "hero-main",
        })).rejects.toThrow("No media resolution trace found");
    });

    it("propagates provider errors without creating a replacement trace", async () => {
        const traceRepository = {
            findLatestByMediaKey: vi.fn(async () => baseTrace),
            createMany: vi.fn(),
            attachSnapshot: vi.fn(),
        };
        const stockRegenerator = {
            execute: vi.fn(async () => {
                throw new Error("No stock image provider resolved");
            }),
        };
        const useCase = new RegenerateMediaByKey(traceRepository as any, stockRegenerator);

        await expect(useCase.execute({
            projectId: "project-1",
            userId: "user-1",
            mediaKey: "hero-main",
        })).rejects.toThrow("No stock image provider resolved");

        expect(stockRegenerator.execute).toHaveBeenCalledWith(expect.objectContaining({ allowFallback: false }));
        expect(traceRepository.createMany).not.toHaveBeenCalled();
    });
});
