import { describe, it, expect } from "vitest";
import { getParser } from "../DocumentParserFactory";

describe("DocumentParserFactory", () => {
    it("returns a parser for application/pdf", () => {
        expect(getParser("application/pdf")).not.toBeNull();
    });

    it("returns a parser for docx mime", () => {
        expect(getParser("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).not.toBeNull();
    });

    it("returns a parser for application/msword", () => {
        expect(getParser("application/msword")).not.toBeNull();
    });

    it("returns a parser for text/html", () => {
        expect(getParser("text/html")).not.toBeNull();
    });

    it("returns a parser for application/xhtml+xml", () => {
        expect(getParser("application/xhtml+xml")).not.toBeNull();
    });

    it("returns a parser for xlsx mime", () => {
        expect(getParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).not.toBeNull();
    });

    it("returns a parser for application/vnd.ms-excel", () => {
        expect(getParser("application/vnd.ms-excel")).not.toBeNull();
    });

    it("returns a parser for pptx mime", () => {
        expect(getParser("application/vnd.openxmlformats-officedocument.presentationml.presentation")).not.toBeNull();
    });

    it("returns a parser for application/vnd.ms-powerpoint", () => {
        expect(getParser("application/vnd.ms-powerpoint")).not.toBeNull();
    });

    it("returns a parser for text/plain", () => {
        expect(getParser("text/plain")).not.toBeNull();
    });

    it("returns a parser for text/markdown", () => {
        expect(getParser("text/markdown")).not.toBeNull();
    });

    it("returns a parser for text/csv", () => {
        expect(getParser("text/csv")).not.toBeNull();
    });

    it("returns a parser for application/json", () => {
        expect(getParser("application/json")).not.toBeNull();
    });

    it("returns null for unknown mime type", () => {
        expect(getParser("application/octet-stream")).toBeNull();
    });

    it("returns null for image mime", () => {
        expect(getParser("image/jpeg")).toBeNull();
    });

    it("is case-insensitive", () => {
        expect(getParser("TEXT/HTML")).not.toBeNull();
        expect(getParser("Application/PDF")).not.toBeNull();
    });

    it("handles mime with charset suffix", () => {
        expect(getParser("text/html; charset=utf-8")).not.toBeNull();
        expect(getParser("text/plain; charset=utf-8")).not.toBeNull();
    });
});
