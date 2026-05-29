import { describe, expect, it, vi } from "vitest";

vi.mock("../../../config", () => ({
    env: {
        UPLOAD_MAX_SIZE_BYTES: 1024 * 1024,
    },
}));

import { FetchExternalImageDownloader } from "../ExternalImageDownloader";

describe("FetchExternalImageDownloader", () => {
    it("rejects non-HTTPS URLs before fetching", async () => {
        const fetchImpl = vi.fn();
        const downloader = new FetchExternalImageDownloader(fetchImpl as unknown as typeof fetch);

        await expect(downloader.download("http://images.pexels.com/photo.jpg")).rejects.toThrow("Only HTTPS");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("rejects hosts outside the provider allowlist", async () => {
        const fetchImpl = vi.fn();
        const downloader = new FetchExternalImageDownloader(fetchImpl as unknown as typeof fetch);

        await expect(downloader.download("https://example.com/photo.jpg")).rejects.toThrow("not allowed");
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
