import test from "node:test";
import assert from "node:assert/strict";
import { preferredExtensionForMimeType, resolveStoredAssetNames } from "../apps/api/dist/application/media/assetMime.js";

test("maps common raster image MIME types to the right extension", () => {
    assert.equal(preferredExtensionForMimeType("image/png"), ".png");
    assert.equal(preferredExtensionForMimeType("image/jpeg"), ".jpg");
    assert.equal(preferredExtensionForMimeType("image/webp"), ".webp");
});

test("replaces the queued SVG placeholder name when the final asset is PNG", () => {
    const result = resolveStoredAssetNames({
        originalName: "hero-shot.svg",
        storedFilename: "asset-123-hero-shot.svg",
        mimeType: "image/png",
    });

    assert.equal(result.originalName, "hero-shot.png");
    assert.equal(result.storedFilename, "asset-123-hero-shot.png");
});

test("keeps the original SVG extension when the output remains SVG", () => {
    const result = resolveStoredAssetNames({
        originalName: "hero-shot.svg",
        storedFilename: "asset-123-hero-shot.svg",
        mimeType: "image/svg+xml",
    });

    assert.equal(result.originalName, "hero-shot.svg");
    assert.equal(result.storedFilename, "asset-123-hero-shot.svg");
});
