/**
 * Shared Puppeteer capture service.
 * Used by CapturePreviewSnapshot use-case and ExportLayer1Zip for ZIP embeds.
 */
import puppeteer from "puppeteer";

export type CaptureFormat = "jpg" | "pdf";

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

// ---------------------------------------------------------------------------
// Core capture logic — launches headless Chromium, renders HTML, returns buffer
// ---------------------------------------------------------------------------
export async function captureHtml(
    html: string,
    format: CaptureFormat
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

        await page.setViewport({ width: 1280, height: 800 });

        await page.setContent(html, {
            waitUntil: "networkidle0",
            timeout: 30_000,
        });

        // Wait for readyState + images (skip broken/external images)
        await page.waitForFunction(
            () => {
                if (document.readyState !== "complete") return false;
                const imgs = Array.from(document.images);
                return !imgs.some((img) => !img.complete && img.naturalWidth === 0 && img.src);
            },
            { timeout: 15_000 }
        );

        // Wait for web fonts
        await page.evaluate(() => document.fonts.ready);

        // Auto-scroll to trigger IntersectionObserver / lazy-load sections.
        // Half-viewport steps with 300ms per step allows CSS transitions to settle.
        await page.evaluate(async () => {
            const step = Math.floor(window.innerHeight / 2);
            const pauseMs = 300;

            const scrollAndWait = (y: number) =>
                new Promise<void>((r) => {
                    window.scrollTo(0, y);
                    setTimeout(r, pauseMs);
                });

            let pos = 0;
            while (pos < document.body.scrollHeight) {
                pos += step;
                await scrollAndWait(pos);
            }
            await scrollAndWait(0);
        });

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
            await page.emulateMediaType("screen");
            const bytes = await page.pdf({
                printBackground: true,
                format: "A4",
                margin: { top: "0", right: "0", bottom: "0", left: "0" },
            });
            return Buffer.from(bytes);
        }
    } finally {
        await browser.close();
    }
}
