import { describe, expect, it } from "vitest";
import { resolvePdfCapturePolicy } from "../PuppeteerCaptureService";

describe("resolvePdfCapturePolicy", () => {
    it("respects preset-managed slide decks via CSS page size", () => {
        const policy = resolvePdfCapturePolicy(
            "<main><div class='slide'>One</div><div class='slide'>Two</div></main>",
            "",
            {
                pageModel: "slide_deck",
                sectionModel: "paginated",
                aspectRatio: "16:9",
                printReady: true,
            },
        );

        expect(policy.preferCssPageSize).toBe(true);
        expect(policy.fallbackFormat).toBeUndefined();
        expect(policy.annotateSections).toBe(false);
    });

    it("keeps print_a4 presets on explicit print media", () => {
        const policy = resolvePdfCapturePolicy(
            "<main><div class='page'>One</div></main>",
            "",
            {
                pageModel: "print_a4",
                sectionModel: "scroll",
                aspectRatio: "A4_portrait",
                printReady: true,
            },
        );

        expect(policy.preferCssPageSize).toBe(true);
        expect(policy.fallbackFormat).toBe("A4");
        expect(policy.annotateSections).toBe(false);
    });

    it("applies section-aware pagination to longform single-page presets without explicit print CSS", () => {
        const policy = resolvePdfCapturePolicy(
            "<main><section>Hero</section><section>Features</section><section>CTA</section></main>",
            "",
            {
                pageModel: "single_page",
                sectionModel: "scroll",
                aspectRatio: "free",
                printReady: false,
            },
        );

        expect(policy.preferCssPageSize).toBe(false);
        expect(policy.fallbackFormat).toBe("A4");
        expect(policy.annotateSections).toBe(true);
        expect(policy.injectPrintStyles).toContain("[data-pdf-section]");
    });

    it("does not override documents that already declare print rules", () => {
        const policy = resolvePdfCapturePolicy(
            "<style>@media print { .chapter { page-break-before: always; } }</style><main><section class='chapter'>A</section></main>",
            "",
            {
                pageModel: "single_page",
                sectionModel: "scroll",
                aspectRatio: "free",
                printReady: false,
            },
        );

        expect(policy.preferCssPageSize).toBe(true);
        expect(policy.annotateSections).toBe(false);
        expect(policy.injectPrintStyles).toBeUndefined();
    });
});
