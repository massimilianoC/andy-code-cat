/**
 * Shared Puppeteer capture service.
 * Used by CapturePreviewSnapshot use-case and ExportLayer1Zip for ZIP embeds.
 */
import puppeteer, { type Page } from "puppeteer";
import type { PresetOutputSpec } from "../../domain/entities/ProjectPreset";

export type CaptureFormat = "jpg" | "pdf";

export interface CaptureHtmlOptions {
    outputSpec?: Pick<PresetOutputSpec, "pageModel" | "sectionModel" | "aspectRatio" | "printReady"> | null;
}

interface PdfCapturePolicy {
    emulateMedia: "screen" | "print";
    preferCssPageSize: boolean;
    fallbackFormat?: "A4";
    injectPrintStyles?: string;
    annotateSections: boolean;
}

const SECTION_AWARE_PRINT_STYLES = `
@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
  }

  body {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  [data-pdf-section],
  img,
  svg,
  canvas,
  table,
  pre,
  blockquote {
    break-inside: avoid-page;
    page-break-inside: avoid;
  }

  [data-pdf-section] + [data-pdf-section] {
    break-before: page;
    page-break-before: always;
  }

  h1, h2, h3 {
    break-after: avoid-page;
    page-break-after: avoid;
  }
}
`;

// ---------------------------------------------------------------------------
// HTML document builder — assembles full HTML document from snapshot artifacts
// ---------------------------------------------------------------------------
export function buildFullDoc(html: string, css: string, js: string): string {
    const isFullDoc = /<!doctype/i.test(html) || /<html[\s>]/i.test(html);
    const styleTag = css.trim() ? `<style>${css}</style>` : "";
    const scriptTag = js.trim() ? `<script>${js}<\/script>` : "";

    if (isFullDoc) {
        let doc = html;
        if (styleTag && !doc.includes(styleTag)) {
            doc = doc.replace(/<\/head>/i, `${styleTag}</head>`);
        }
        if (scriptTag && !doc.includes(scriptTag)) {
            doc = doc.replace(/<\/body>/i, `${scriptTag}</body>`);
        }
        return doc;
    }

    return `<!doctype html><html><head>${styleTag}</head><body>${html}${scriptTag}</body></html>`;
}

function hasExplicitPdfLayout(html: string, css: string): boolean {
    const combined = `${html}\n${css}`;
    return /@page\b/i.test(combined)
        || /@media\s+print/i.test(combined)
        || /\bclass\s*=\s*["'][^"']*\b(?:slide|page|pdf-page-break)\b/i.test(html)
        || /data-pdf-(?:page|section)\b/i.test(html);
}

export function resolvePdfCapturePolicy(
    html: string,
    css: string,
    outputSpec?: CaptureHtmlOptions["outputSpec"],
): PdfCapturePolicy {
    const pageModel = outputSpec?.pageModel;

    if (pageModel === "slide_deck" || pageModel === "print_a4" || hasExplicitPdfLayout(html, css)) {
        return {
            emulateMedia: "print",
            preferCssPageSize: true,
            fallbackFormat: pageModel === "print_a4" ? "A4" : undefined,
            annotateSections: false,
        };
    }

    return {
        emulateMedia: "print",
        preferCssPageSize: false,
        fallbackFormat: "A4",
        injectPrintStyles: SECTION_AWARE_PRINT_STYLES,
        annotateSections: true,
    };
}

async function annotatePdfSections(page: Page): Promise<void> {
    await page.evaluate(`(() => {
        const hasExplicitMarkers = document.querySelector(
          "[data-pdf-page], [data-pdf-section], .pdf-page-break, .slide, .page"
        );
        if (hasExplicitMarkers) return;

        let sequence = 0;
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.height >= 120 && style.display !== "none" && style.visibility !== "hidden";
        };
        const isSemantic = (el) => /^(HEADER|MAIN|SECTION|ARTICLE|FOOTER)$/i.test(el.tagName);
        const mark = (el) => {
          if (!el || el.hasAttribute("data-pdf-section") || !isVisible(el)) return;
          sequence += 1;
          el.setAttribute("data-pdf-section", String(sequence));
        };

        Array.from(document.body.children)
          .filter((el) => isSemantic(el))
          .forEach((el) => {
            if (el.tagName === "MAIN") return;
            mark(el);
          });

        const main = document.querySelector("main");
        if (main) {
          const candidates = Array.from(main.children).filter((el) => {
            if (!(el instanceof HTMLElement)) return false;
            if (!isVisible(el)) return false;
            if (isSemantic(el)) return true;
            return el.getBoundingClientRect().height >= 260 || Boolean(el.querySelector("h1, h2, h3"));
          });

          if (candidates.length > 0) {
            candidates.forEach((el) => mark(el));
          } else {
            mark(main);
          }
        } else {
          Array.from(document.body.children)
            .filter((el) => el instanceof HTMLElement && !isSemantic(el) && isVisible(el))
            .forEach((el) => {
              if (el.getBoundingClientRect().height >= 260 || el.querySelector("h1, h2, h3")) {
                mark(el);
              }
            });
        }
    })()`);
}

// ---------------------------------------------------------------------------
// Core capture logic — launches headless Chromium, renders HTML, returns buffer
// ---------------------------------------------------------------------------
export async function captureHtml(
    html: string,
    format: CaptureFormat,
    options?: CaptureHtmlOptions,
): Promise<Buffer> {
    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const browser = await puppeteer.launch(launchOptions);
    try {
        const page = await browser.newPage();
        const pdfPolicy = format === "pdf"
            ? resolvePdfCapturePolicy(html, "", options?.outputSpec)
            : null;

        await page.setViewport({ width: 1280, height: 800 });
        await page.emulateMediaType(pdfPolicy?.emulateMedia ?? "screen");

        await page.setContent(html, {
            waitUntil: "networkidle0",
            timeout: 30_000,
        });

        if (pdfPolicy?.injectPrintStyles) {
            await page.addStyleTag({ content: pdfPolicy.injectPrintStyles });
        }
        if (pdfPolicy?.annotateSections) {
            await annotatePdfSections(page);
        }

        // Wait for readyState + images (skip broken/external images).
        // NOTE: callbacks are passed as strings to avoid esbuild (tsx) injecting
        // __name() helpers that are defined only in the Node.js module scope and
        // would cause ReferenceError inside Puppeteer's browser context.
        await page.waitForFunction(
            `document.readyState === "complete" &&
             !Array.from(document.images).some(
               function(img){ return !img.complete && img.naturalWidth === 0 && img.src; }
             )`,
            { timeout: 15_000 }
        );

        // Wait for web fonts
        await page.evaluate(`document.fonts.ready`);

        // Auto-scroll to trigger IntersectionObserver / lazy-load sections.
        // Half-viewport steps with 300ms per step allows CSS transitions to settle.
        await page.evaluate(`(async function() {
            var step = Math.floor(window.innerHeight / 2);
            var pauseMs = 300;
            function scrollAndWait(y) {
                return new Promise(function(r) {
                    window.scrollTo(0, y);
                    setTimeout(r, pauseMs);
                });
            }
            var pos = 0;
            while (pos < document.body.scrollHeight) {
                pos += step;
                await scrollAndWait(pos);
            }
            await scrollAndWait(0);
        })()`);


        // Final settle for any scroll-up reveals / sticky elements
        await new Promise<void>((r) => setTimeout(r, 800));

        if (format === "jpg") {
            const bytes = await page.screenshot({
                type: "jpeg",
                quality: 92,
                fullPage: true,
            });
            return Buffer.from(bytes);
        } else {
            const bytes = await page.pdf({
                printBackground: true,
                format: pdfPolicy?.fallbackFormat,
                preferCSSPageSize: pdfPolicy?.preferCssPageSize ?? false,
                margin: { top: "0", right: "0", bottom: "0", left: "0" },
            });
            return Buffer.from(bytes);
        }
    } finally {
        await browser.close();
    }
}
