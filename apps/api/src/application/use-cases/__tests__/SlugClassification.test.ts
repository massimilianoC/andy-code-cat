import { describe, expect, it } from "vitest";
import { classifySlugFormat, customSlugSchema, SLUG_FORMAT_RE } from "@andy-code-cat/contracts";

// These tests lock the coherent-reason contract the UI depends on: every rejected
// slug must be classifiable as "reserved" or "invalid" (never silently "taken"),
// and the format the client pre-validates must match the schema the server enforces.
describe("classifySlugFormat", () => {
    it("accepts well-formed slugs", () => {
        for (const slug of ["my-bakery", "ab", "a1", "shop2026", "a-b-c"]) {
            expect(classifySlugFormat(slug)).toEqual({ normalized: slug, reason: "ok" });
        }
    });

    it("normalizes case and surrounding whitespace before classifying", () => {
        expect(classifySlugFormat("  My-Bakery  ")).toEqual({ normalized: "my-bakery", reason: "ok" });
    });

    it("flags reserved names distinctly from invalid format", () => {
        for (const slug of ["api", "admin", "www", "p", "pageforge"]) {
            expect(classifySlugFormat(slug).reason).toBe("reserved");
        }
    });

    it("flags malformed slugs as invalid (not reserved, not taken)", () => {
        for (const slug of ["a", "-abc", "abc-", "AB$", "with space", "x".repeat(31)]) {
            expect(classifySlugFormat(slug).reason).toBe("invalid");
        }
    });

    it("stays consistent with the zod schema the publish/PATCH routes enforce", () => {
        const samples = ["my-bakery", "ab", "api", "admin", "a", "-bad", "ok-slug"];
        for (const slug of samples) {
            const schemaAccepts = customSlugSchema.safeParse(slug).success;
            const classifierAccepts = classifySlugFormat(slug).reason === "ok";
            expect(classifierAccepts).toBe(schemaAccepts);
        }
    });

    it("uses a shared format regex bound to 2-30 chars", () => {
        expect(SLUG_FORMAT_RE.test("ab")).toBe(true);
        expect(SLUG_FORMAT_RE.test("a")).toBe(false);
        expect(SLUG_FORMAT_RE.test("x".repeat(30))).toBe(true);
        expect(SLUG_FORMAT_RE.test("x".repeat(31))).toBe(false);
    });
});
