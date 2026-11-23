import { describe, it, expect, beforeAll, vi } from "vitest";

vi.mock("@/lib/api", () => ({ downloadProjectAssetDataUrl: vi.fn(async () => "data:image/png;base64,AAAA") }));

import { parseProtectedAssetDownloadUrl, resolvePreviewAssetUrls } from "../resolvePreviewAssetUrls";
import { downloadProjectAssetDataUrl } from "@/lib/api";

const PROJECT = "507f1f77bcf86cd799439011";
const ASSET = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
    (globalThis as unknown as { window: unknown }).window = { location: { origin: "https://andy.example.test" } };
});

describe("preview asset URLs from generated HTML cannot steer the authenticated fetch", () => {
    it("accepts a plain project asset download URL", () => {
        expect(parseProtectedAssetDownloadUrl(`/v1/projects/${PROJECT}/assets/${ASSET}/download`)).toEqual({ projectId: PROJECT, assetId: ASSET });
    });

    it("rejects encoded traversal in either id (review: /v1/admin/users via %2F..%2F)", () => {
        expect(parseProtectedAssetDownloadUrl("/v1/projects/x%2F..%2F..%2Fadmin%2Fusers%3F/assets/y/download")).toBeNull();
        expect(parseProtectedAssetDownloadUrl(`/v1/projects/${PROJECT}/assets/..%2F..%2Fadmin/download`)).toBeNull();
    });

    it("does not fetch another project's assets with the user's token", async () => {
        const other = "607f1f77bcf86cd799439022";
        const html = `<img src="/v1/projects/${other}/assets/${ASSET}/download"><img src="/v1/projects/${PROJECT}/assets/${ASSET}/download">`;
        const result = await resolvePreviewAssetUrls({ html, css: "", token: "t", projectId: PROJECT });
        expect(vi.mocked(downloadProjectAssetDataUrl)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(downloadProjectAssetDataUrl)).toHaveBeenCalledWith("t", PROJECT, ASSET);
        expect(result.html).toContain(`/v1/projects/${other}/assets/${ASSET}/download`);
    });
});
