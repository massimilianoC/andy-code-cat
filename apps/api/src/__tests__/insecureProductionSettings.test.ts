import { beforeAll, describe, expect, it } from "vitest";

process.env.MONGODB_URI ??= "mongodb://localhost:27017/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-min-32-chars-!!xyz";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-min-32-chars-!!xyz";

// Imported after the env above is in place: config.ts validates process.env when it loads.
let insecureProductionSettings: typeof import("../config").insecureProductionSettings;
beforeAll(async () => {
    ({ insecureProductionSettings } = await import("../config"));
});

const safe = {
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.example.com",
    EXPORT_JWT_SECRET: "a-random-export-secret-of-enough-length",
    STORAGE_ADAPTER: "local",
    MINIO_ACCESS_KEY: "minioadmin",
    MINIO_SECRET_KEY: "minioadmin",
};

describe("insecureProductionSettings", () => {
    it("reports nothing outside production", () => {
        expect(insecureProductionSettings({ ...safe, NODE_ENV: "development", CORS_ORIGIN: "*" })).toEqual([]);
    });

    it("reports nothing for a safe production configuration", () => {
        expect(insecureProductionSettings(safe)).toEqual([]);
    });

    it("flags a wildcard CORS origin, alone or in a list", () => {
        expect(insecureProductionSettings({ ...safe, CORS_ORIGIN: "*" })).toHaveLength(1);
        expect(insecureProductionSettings({ ...safe, CORS_ORIGIN: "https://app.example.com, *" })).toHaveLength(1);
    });

    it("flags the public export-token default", () => {
        const warnings = insecureProductionSettings({ ...safe, EXPORT_JWT_SECRET: "change-me-export-secret-32chars!!" });
        expect(warnings.join(" ")).toMatch(/EXPORT_JWT_SECRET/);
    });

    it("flags default MinIO credentials only when MinIO is the storage adapter", () => {
        expect(insecureProductionSettings({ ...safe, STORAGE_ADAPTER: "minio" }).join(" ")).toMatch(/minioadmin/);
        expect(insecureProductionSettings({ ...safe, STORAGE_ADAPTER: "minio", MINIO_ACCESS_KEY: "", MINIO_SECRET_KEY: "" })).toHaveLength(1);
        expect(insecureProductionSettings({ ...safe, STORAGE_ADAPTER: "minio", MINIO_ACCESS_KEY: "andy-1", MINIO_SECRET_KEY: "s3cr3t-value" })).toEqual([]);
    });
});
