import { describe, expect, it } from "vitest";
import { normalizeDatasetBuffer } from "../DatasetRuntime";

describe("readSqlTables ReDoS resistance", () => {
    it("terminates quickly on unclosed-paren adversarial input", async () => {
        const payload = "insert\tinto\t-((".repeat(200_000);
        const start = Date.now();
        await expect(normalizeDatasetBuffer(Buffer.from(payload, "utf8"), "application/sql")).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(1000);
    });

    it("terminates quickly on missing-semicolon adversarial input", async () => {
        const payload = "insert into t (a) values (1,".repeat(200_000);
        const start = Date.now();
        await expect(normalizeDatasetBuffer(Buffer.from(payload, "utf8"), "application/sql")).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(1000);
    });
});
