const TAILWIND_CDN = '<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>';
const TAILWIND_CLASS_RE = /class=["'][^"']*(?:flex|grid|py-|px-|text-|bg-|font-|rounded|shadow|container|mx-auto)/i;
// Match only LOCAL placeholder stylesheet/script references (not CDN URLs starting with http/https//)
const EXTERNAL_CSS_RE = /<link[^>]+href=["'](?!https?:\/\/|\/\/)[^"']*\.css["'][^>]*\/?>/gi;
const EXTERNAL_JS_RE = /<script[^>]+src=["'](?!https?:\/\/|\/\/)[^"']*\.js["'][^>]*><\/script>/gi;

export type PreviewQuality = "clean" | "injected" | "fragment" | "raw-html" | "none";

export interface PreviewResult {
    doc: string;
    quality: PreviewQuality;
}

function ensureTailwind(doc: string): string {
    if (TAILWIND_CLASS_RE.test(doc) && !/cdn\.tailwindcss\.com/i.test(doc)) {
        return doc.replace("</head>", `${TAILWIND_CDN}</head>`);
    }
    return doc;
}

export function buildPreviewDoc(html: string, css: string, js: string, rawResponse?: string): PreviewResult {
    const isFullDoc = /<!doctype/i.test(html) || /<html[\s>]/i.test(html);

    if (isFullDoc) {
        const hasExternalCss = EXTERNAL_CSS_RE.test(html);
        const hasExternalJs = EXTERNAL_JS_RE.test(html);
        const needsInjection = (css && hasExternalCss) || (js && hasExternalJs);

        const styleTag = css ? `<style>${css}</style>` : "";
        const scriptTag = js ? `<script>${js}<\/script>` : "";

        let doc = html;

        // Replace external refs with inline
        if (css) doc = doc.replace(EXTERNAL_CSS_RE, styleTag);
        if (js) doc = doc.replace(EXTERNAL_JS_RE, scriptTag);

        // Inject if replacement didn't fire (e.g. link was missing but css field has content)
        if (css && styleTag && !doc.includes(styleTag)) {
            doc = doc.replace("</head>", `${styleTag}</head>`);
        }
        // Skip fallback JS injection if the JS content is already embedded inline in the HTML.
        // The LLM may put the same code both in artifacts.js and in an inline <script> block,
        // which would cause duplicate const/let/var declarations (e.g. "Identifier already declared").
        const jsLead = js ? js.trim().slice(0, 60) : "";
        const jsAlreadyEmbedded = jsLead.length >= 20 && doc.includes(jsLead);
        if (js && scriptTag && !doc.includes(scriptTag) && !jsAlreadyEmbedded) {
            doc = doc.replace("</body>", `${scriptTag}</body>`);
        }

        doc = ensureTailwind(doc);

        return { doc, quality: needsInjection ? "injected" : "clean" };
    }

    // Fragment: wrap in full document
    if (html.trim()) {
        const styleTag = css ? `<style>${css}</style>` : "";
        const scriptTag = js ? `<script>${js}<\/script>` : "";
        const doc = ensureTailwind(
            `<!doctype html><html><head>${styleTag}</head><body>${html}${scriptTag}</body></html>`
        );
        return { doc, quality: "fragment" };
    }

    // Last resort: try to extract HTML from rawResponse
    if (rawResponse) {
        const fullDocMatch = rawResponse.match(/(<!DOCTYPE[\s\S]*<\/html>)/i);
        if (fullDocMatch?.[1]) {
            return { doc: ensureTailwind(fullDocMatch[1]), quality: "raw-html" };
        }
        const bodyMatch = rawResponse.match(/<body[\s\S]*<\/body>/i);
        if (bodyMatch?.[0]) {
            return {
                doc: ensureTailwind(`<!doctype html><html><head></head>${bodyMatch[0]}</html>`),
                quality: "raw-html",
            };
        }
    }

    return { doc: "", quality: "none" };
}
