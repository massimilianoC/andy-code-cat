/**
 * Portable Puppeteer capture service — screenshot + PDF export.
 *
 * Generalized from Andy Code Cat's apps/api/src/infra/capture/PuppeteerCaptureService.ts.
 * Zero dependencies on any specific app's domain/DB layer — takes an HTML string (or a URL),
 * returns a Buffer. Wire it into your own routes/jobs; see express-routes-example.ts.
 *
 * Install: npm install puppeteer
 * Docker:  see dockerfile-snippet.md — this will NOT work without a Chromium binary available
 *          at runtime.
 */
import puppeteer, { type Page } from "puppeteer";

export type CaptureFormat = "jpg" | "pdf";

/** Caller-supplied intent about how the content should be paginated when exported as PDF. */
export interface PdfLayoutHint {
    /** Content already ships its own @page/@media print rules or explicit slide/page markup. */
    hasExplicitPrintLayout?: boolean;
    /** Force a fixed page format (e.g. "A4") instead of respecting the content's own CSS page size. */
    forceFormat?: "A4" | "Letter" | "Legal";
    /** Content is a slide deck / has its own CSS-defined page size — respect it as-is. */
    preferContentPageSize?: boolean;
}

export interface CaptureHtmlOptions {
    /** Viewport size — defaults to 1280x800. */
    viewport?: { width: number; height: number };
    /** JPEG quality 0-100 — defaults to 92. Ignored for PDF. */
    jpegQuality?: number;
    pdfLayout?: PdfLayoutHint;
}

interface ResolvedPdfPolicy {
    emulateMedia: "screen" | "print";
    preferCssPageSize: boolean;
    fallbackFormat?: "A4" | "Letter" | "Legal";
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
// HTML document builder — assembles a full HTML document from separate
// html/css/js artifact strings (e.g. from an AI-generated page or CMS record).
// Skip this if your content is already served at a URL — use captureUrl() instead.
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

function resolvePdfPolicy(hint?: PdfLayoutHint): ResolvedPdfPolicy {
    if (hint?.hasExplicitPrintLayout || hint?.preferContentPageSize) {
        return {
            emulateMedia: "print",
            preferCssPageSize: true,
            fallbackFormat: hint?.forceFormat,
            annotateSections: false,
        };
    }

    return {
        emulateMedia: "print",
        preferCssPageSize: false,
        fallbackFormat: hint?.forceFormat ?? "A4",
        injectPrintStyles: SECTION_AWARE_PRINT_STYLES,
        annotateSections: true,
    };
}

/**
 * Auto-marks top-level "sections" of the page with data-pdf-section so the
 * print CSS above can insert sane page breaks, for content that has no
 * explicit print layout of its own (no @page, no .slide/.page classes, etc).
 *
 * IMPORTANT: passed to page.evaluate() as a STRING, not a function reference.
 * esbuild/tsx (and similar dev-mode transpilers) can inject helper functions
 * like __name() into a closure that only exist in Node's module scope — if
 * you pass a real function reference here, Puppeteer serializes the closure
 * and you get a ReferenceError inside the browser context. Keep this as a
 * template string.
 */
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

/** Shared "wait until it's really ready to shoot" sequence for both jpg and pdf. */
async function waitUntilSettled(page: Page): Promise<void> {
    // Wait for readyState + images (skip broken/external images that never resolve).
    // Passed as a string for the same esbuild/tsx reason as annotatePdfSections above.
    await page.waitForFunction(
        `document.readyState === "complete" &&
         !Array.from(document.images).some(
           function(img){ return !img.complete && img.naturalWidth === 0 && img.src; }
         )`,
        { timeout: 15_000 }
    );

    // Wait for web fonts to finish painting.
    await page.evaluate(`document.fonts.ready`);

    // Auto-scroll to trigger IntersectionObserver-based lazy-load and let CSS
    // transitions settle. Half-viewport steps, 300ms pause per step.
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

    // Final settle for sticky elements / scroll-up reveals.
    await new Promise<void>((r) => setTimeout(r, 800));
}

async function withBrowserPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
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
        return await fn(page);
    } finally {
        // Always close, even on error — a thrown mid-capture error must not
        // leak a Chromium process (leaked processes are the #1 cause of OOM
        // in capture-heavy services).
        await browser.close();
    }
}

async function shoot(page: Page, format: CaptureFormat, options?: CaptureHtmlOptions): Promise<Buffer> {
    const pdfPolicy = format === "pdf" ? resolvePdfPolicy(options?.pdfLayout) : null;

    await page.setViewport(options?.viewport ?? { width: 1280, height: 800 });
    await page.emulateMediaType(pdfPolicy?.emulateMedia ?? "screen");

    if (pdfPolicy?.injectPrintStyles) {
        await page.addStyleTag({ content: pdfPolicy.injectPrintStyles });
    }
    if (pdfPolicy?.annotateSections) {
        await annotatePdfSections(page);
    }

    await waitUntilSettled(page);

    if (format === "jpg") {
        const bytes = await page.screenshot({
            type: "jpeg",
            quality: options?.jpegQuality ?? 92,
            fullPage: true,
        });
        return Buffer.from(bytes);
    }

    const bytes = await page.pdf({
        printBackground: true,
        format: pdfPolicy?.fallbackFormat,
        preferCSSPageSize: pdfPolicy?.preferCssPageSize ?? false,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Capture an in-memory HTML document (already-assembled, e.g. via buildFullDoc). */
export async function captureHtml(
    html: string,
    format: CaptureFormat,
    options?: CaptureHtmlOptions,
): Promise<Buffer> {
    return withBrowserPage(async (page) => {
        await page.setContent(html, { waitUntil: "networkidle0", timeout: 30_000 });
        return shoot(page, format, options);
    });
}

/**
 * Capture content that's already served at a URL — preferred over captureHtml
 * when the content depends on server-rendered data/auth you don't want to
 * duplicate client-side, or when it's the src of an <iframe> you'd rather
 * capture directly than reconstruct the parent page's rendering context.
 *
 * SECURITY: only call this with URLs your own backend controls/trusts. Do not
 * expose an endpoint that lets a caller supply an arbitrary external URL here
 * — headless Chromium fetching an attacker-controlled URL is a classic SSRF
 * vector (it can reach internal network services). If you need to support
 * external URLs, add an allowlist + network isolation review first.
 */
export async function captureUrl(
    url: string,
    format: CaptureFormat,
    options?: CaptureHtmlOptions & { extraHeaders?: Record<string, string> },
): Promise<Buffer> {
    return withBrowserPage(async (page) => {
        if (options?.extraHeaders) {
            await page.setExtraHTTPHeaders(options.extraHeaders);
        }
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
        return shoot(page, format, options);
    });
}
