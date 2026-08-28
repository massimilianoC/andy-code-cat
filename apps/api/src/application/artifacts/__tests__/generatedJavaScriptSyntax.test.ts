import { describe, expect, it } from "vitest";
import { assertGeneratedJavaScriptSyntax, GeneratedJavaScriptSyntaxError } from "../generatedJavaScriptSyntax";

describe("assertGeneratedJavaScriptSyntax", () => {
    it("accepts empty and valid generated JavaScript without executing it", () => {
        expect(() => assertGeneratedJavaScriptSyntax("")).not.toThrow();
        expect(() => assertGeneratedJavaScriptSyntax("throw new Error('must not execute')")).not.toThrow();
    });

    it("returns an actionable 422 diagnostic for invalid generated JavaScript", () => {
        try {
            assertGeneratedJavaScriptSyntax("const valid = true;\n{ \"version\": \"media-manifest-v1\" }");
            throw new Error("Expected syntax validation to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(GeneratedJavaScriptSyntaxError);
            expect(error).toMatchObject({
                statusCode: 422,
                code: "INVALID_GENERATED_JAVASCRIPT",
                diagnostic: { file: "artifacts.js" },
            });
        }
    });
});
