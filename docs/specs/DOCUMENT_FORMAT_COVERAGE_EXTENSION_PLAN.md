# Document Format Coverage Extension — Implementation Plan

**Version:** 1.1
**Status:** Implemented
**Date:** 2026-08-10
**Scope:** extend the document-parsing coverage of the enrichment pipeline to legacy `.doc`,
RTF and ODT, inside the existing `DocumentParser` pattern — no refactor of the working
PDF / DOCX / PPTX / XLSX path
**Extends:** [`docs/specs/DOCUMENT_CONTEXT_LAYER_SPEC.md`](DOCUMENT_CONTEXT_LAYER_SPEC.md)
**Audience:** backend agents, maintainers

---

## 1. Purpose and scope

The Zero Effort flow (micro-prompt + attachments → generated artifact) is only as good as the
context it can extract from the user's attachments. Today a user who drags in a `.rtf` brief or
an `.odt` company profile is silently blocked at the upload filter, and a user who drags in a
legacy binary `.doc` gets an attachment that *looks* accepted but yields no usable text.

This plan closes those three gaps **and nothing else**.

### In scope

- Legacy binary `.doc` (OLE/CFB, pre-2007) — currently mis-routed to `mammoth`
- RTF (`.rtf`) — no parser, no mime mapping, not accepted by the frontend
- ODT (`.odt`, OpenDocument Text) — no parser, no mime mapping, not accepted by the frontend
- Confirmation audit of the already-covered TXT / MD / PDF path
- Keeping the **four** duplicated mime maps (parser factory, kind detector, upload allowlist,
  frontend accept list) in sync

### Explicitly NOT in scope

- Any refactor of `PdfParser`, `DocxParser`, `PptxParser`, `ExcelParser`, `HtmlParser`,
  `StructuredDataParser`, `AssetEnrichmentPipeline` beyond the additive mapping lines
- OCR for scanned/image-only PDFs
- `.odp` / `.ods` (OpenDocument Presentation / Spreadsheet) — see §9.2, deliberately deferred
- The pipeline reliability issues listed in §10 (already diagnosed, tracked separately)

---

## 2. Current coverage — verified audit

Source of truth read for this audit:
`apps/api/src/application/documents/parsers/DocumentParserFactory.ts`,
`apps/api/src/application/documents/enrichment/EnrichmentKindDetector.ts`,
`apps/api/src/application/use-cases/UploadProjectAsset.ts`,
`apps/web/components/dashboard/VibeCoreEntry.tsx`.

| Mime type | Factory → parser | Kind detector | Upload allowlist | Frontend accepted | Real behaviour |
|---|---|---|---|---|---|
| `application/pdf` | `parsePdf` (pdf-parse) | `pdf` | ✅ | ✅ | OK (see §2.2) |
| `…wordprocessingml.document` (.docx) | `parseDocx` (mammoth) | `docx` | ✅ | ✅ | OK |
| `application/msword` (.doc) | `parseDocx` (mammoth) | `docx` | ✅ | ✅ | **BROKEN — §2.1** |
| `text/plain`, `text/markdown`, `text/x-markdown` | `parsePlainText` | `txt` / `md` | ✅ (prefix `text/`) | ✅ | OK |
| `text/html`, `application/xhtml+xml` | `parseHtml` (cheerio) | `html` | ✅ | ✅ | OK |
| `…spreadsheetml.sheet` (.xlsx), `application/vnd.ms-excel` (.xls) | `parseExcel` (SheetJS) | `xlsx` | ✅ | ✅ | OK — SheetJS reads legacy BIFF `.xls` natively |
| `text/csv`, `application/csv` | `parseExcel` | `csv` | ✅ | ✅ | OK |
| `…presentationml.presentation` (.pptx) | `parsePptx` (adm-zip+cheerio) | `pptx` | ✅ | ✅ | OK |
| `application/vnd.ms-powerpoint` (.ppt legacy) | `parsePptx` | `pptx` | ✅ | ✅ | **BROKEN — §2.3** |
| `application/json`, `text/xml`, `application/xml` | `parseStructuredData` | `txt` | ✅ | partially | OK |
| `application/rtf`, `text/rtf` | ❌ none | `unknown` | text/rtf passes via `text/` prefix; `application/rtf` rejected | ❌ | **GAP** |
| `application/vnd.oasis.opendocument.text` (.odt) | ❌ none | `unknown` | ❌ | ❌ | **GAP** |

### 2.1 Legacy `.doc` — hypothesis confirmed

`application/msword` is mapped to the same branch as `.docx` in both
`DocumentParserFactory.ts` (line 17) and `EnrichmentKindDetector.ts` (line 6), so it is parsed
with `mammoth.extractRawText()`.

Mammoth's own documentation is explicit that it converts **`.docx`** documents only; it opens
the file as an OOXML zip package. A genuine legacy `.doc` is an OLE2/CFB compound binary
(magic `D0 CF 11 E0 A1 B1 1A E1`), not a zip (`50 4B 03 04`), so mammoth's zip reader throws
before any text is produced.

Observable effect today: `parseDocx` rejects → the `catch` in `AssetEnrichmentPipeline.enrich()`
writes a trace with `enrichmentStatus: "failed"` and a low-level zip error message, Layer D
receives nothing, and the user sees an attachment that produced no context — with no
actionable explanation. It is a *loud-in-the-log, silent-in-the-UX* failure.

Note that `.doc` is also in the accept lists of the frontend (`accept=".pdf,.docx,.doc,…"`) and
in the server upload allowlist, so the platform actively invites a file it cannot read.

### 2.2 Robustness audit of the parsers we are NOT touching

Read for this audit: `PdfParser.ts`, `PlainTextParser.ts`, `HtmlParser.ts`.

| Parser | Size guard | Error handling | Findings |
|---|---|---|---|
| `PdfParser` | `MAX_CHARS = 120_000` truncation | none local — relies on pipeline `try/catch` | Good: strips NUL and C0 control chars, warns under `MIN_TEXT_WARN_CHARS = 50` (scanned-PDF heuristic), reports `numpages`. Minor gap: the "suspiciously short" warning only reaches the server log — it is never surfaced on the trace, so a scanned image-only PDF ends as a `ready` trace with an empty `textLayer`. Out of scope, worth a follow-up. |
| `PlainTextParser` | `MAX_CHARS` truncation | synchronous, cannot throw in practice | Good enough. Minor gap: `buffer.toString("utf8")` assumes UTF-8; a Windows-1252 `.txt` produces replacement characters. No BOM stripping (a UTF-8 BOM leaves `﻿` as the first char, which can leak into `detectedTitle`). Low impact, out of scope. |
| `HtmlParser` | `MAX_CHARS` truncation | synchronous | Good: removes `script/style/noscript/head`, falls back to `$.text()` when `<body>` is empty, counts headings as `sectionCount`. Minor gap: `replace(/\s+/g, " ")` flattens the document to a single line, destroying paragraph structure that the brief LLM could otherwise use. Deliberate today; not changed here. |

**Conclusion:** TXT / MD / PDF are adequately handled for the use case. No change required by
this plan. The gaps listed are cosmetic-to-minor and explicitly deferred.

### 2.3 Adjacent finding — legacy `.ppt`

`application/vnd.ms-powerpoint` (binary PowerPoint 97-2003) is routed to `parsePptx`, which
opens the buffer with `adm-zip`. Same failure class as `.doc`: a legacy `.ppt` is an OLE
compound file, `adm-zip` throws "Invalid or unsupported zip format", the trace ends `failed`.

Unlike `.doc`, there is **no maintained pure-JS extractor** for binary `.ppt`. The
recommendation (§4.4) is therefore the honest one: detect it and fail with an explicit,
user-actionable message instead of a zip stack trace. Included in this plan because it is one
line in the same map and the same guard helper.

### 2.4 The four-map duplication risk

A mime type must be added in **four** places, none of which are checked against each other:

1. `DocumentParserFactory.ts` — `*_MIMES` sets → picks the parser
2. `EnrichmentKindDetector.ts` — parallel `*_MIMES` sets → picks the `EnrichmentAssetKind`,
   and `isDocumentKind()` gates whether `enrichDocument()` runs at all
3. `UploadProjectAsset.ts` — `ALLOWED_MIME_EXACT` / `ALLOWED_MIME_PREFIXES` → 4xx at upload
4. `apps/web/components/dashboard/VibeCoreEntry.tsx` — `ACCEPTED_MIME_TYPES` + the `accept`
   attribute → silently drops the file client-side

Failure modes if they drift:

- In 1 but not 2 → `detectEnrichmentKind` returns `unknown`, `isDocumentKind` is false,
  `enrichDocument()` never runs, the parser is dead code and the trace is `skipped`.
- In 2 but not 1 → `enrichDocument()` runs, `getParser()` returns `null`, trace is `skipped`.
- In 1+2 but not 3 → upload rejected with 400 before enrichment is ever reached.
- In 1+2+3 but not 4 → the file is dropped in the browser with the generic
  "Some files are unsupported or exceed the allowed limits" toast.

§7.4 adds a parity test so this drift becomes a red test instead of a silent skip.

---

## 3. Package research

Constraint applied to every candidate: **must run inside the API Docker image with `npm ci`
only** — no LibreOffice, no `antiword`, no `unrtf`, no `textutil`, no native toolchain.
This immediately disqualifies `textract` (shells out to `unrtf`/`textutil`) and every
`convertapi`-style hosted converter (network dependency + data egress of user documents).

### 3.1 RTF

| Package | Weekly downloads | Last publish | Deps | System binaries | Verdict |
|---|---|---|---|---|---|
| **`rtf-parser`** (iarna) | ~64k | 1.3.3 — Oct 2019 | `iconv-lite@^0.4`, `readable-stream@^2` | none | **Recommended.** Real RTF tokenizer: emits `RTFDocument → content[RTFParagraph] → content[RTFSpan{value}]`, so paragraphs (→ `sectionCount`) come for free. Handles `\'xx` codepage escapes via iconv-lite and `\uN` unicode escapes — the part a homemade regex gets wrong. Cons: unmaintained since 2019, callback API (trivial to promisify), **no TypeScript types** (use the dynamic-import cast already used by `PptxParser` for `adm-zip`), old but pure-JS transitive deps. |
| `rtf-stream-parser` | ~52k | 3.8.1 — Nov 2025 | zero, ships `.d.ts` | none | **Rejected for our use case.** Actively maintained and technically the nicest package, but `deEncapsulate*` only handles *Outlook/Exchange RTF-encapsulated* bodies (`[MS-OXRTFEX]`) and **throws on ordinary RTF documents**. Using only its low-level `Tokenizer` to rebuild text means reimplementing destination/group/escape handling by hand — strictly more work than `rtf-parser`. |
| `officeparser` | ~675k | 7.x, active | `decompress`, `@xmldom/xmldom`, `file-type`, `rimraf` | none | **Rejected as primary.** Covers rtf + odt + docx + pptx + xlsx + pdf in one library — attractive on paper, but adopting it either duplicates five parsers we already have and trust, or forces the refactor this plan explicitly forbids. Its `decompress` dependency chain is also heavy for two file types. Keep on file as the "if we ever consolidate" option. |
| `rtf2text`, `rtf-converter`, `read-rtf` | low | 2018–2023 | small | none | Rejected: regex-level de-markup with weaker unicode/codepage handling than `rtf-parser`, and no meaningful maintenance advantage. |

**Recommendation: `rtf-parser`**, wrapped in a promise and guarded by a `try/catch`.
**Fallback (in-file, no extra dependency):** a `stripRtfMarkup()` regex de-markup helper used
when `rtf-parser` throws or returns empty text — see §6.2. This gives graceful degradation
without a second package, and mirrors the "parser owns its own defensiveness" style of
`PptxParser`.

### 3.2 ODT

ODT is a zip+XML package exactly like `.docx`/`.pptx`: the body lives in `content.xml` as
`<office:text>` containing `<text:h>` and `<text:p>` elements.

| Option | New deps | Verdict |
|---|---|---|
| **Manual `adm-zip` + `cheerio` on `content.xml`** | **none** (both already in `apps/api/package.json`) | **Recommended.** ~60 lines, structurally identical to `PptxParser.ts`, gives headings (`text:h`) as `sectionCount` for free, zero supply-chain and zero Docker impact, and the pattern is already proven and tested in this repo. |
| `officeparser` | 4 transitive deps | Rejected — see §3.1; a whole office suite for one zip+XML read we can already do. |
| `odf-kit` / `node-odt` | 1–2 | Rejected — oriented to *generating*/templating ODT, low adoption, extraction is a side feature. |

**Recommendation: manual parser (`OdtParser.ts`) with the existing `adm-zip` + `cheerio`.**
**Fallback:** none needed — if `content.xml` is missing or unreadable the parser returns an
empty `ParsedDocument`, exactly like `parsePptx` on an empty zip.

### 3.3 Legacy binary `.doc`

| Option | Weekly downloads | Last publish | Deps | System binaries | Verdict |
|---|---|---|---|---|---|
| **`word-extractor`** (morungos) | ~474k | 1.0.4 — Jul 2021 | `saxes@^5`, `yauzl@^2` | **none** | **Recommended.** Purpose-built pure-JS reader for the OLE/CFB Word format; `extract()` accepts a **Buffer** directly (no temp file — important, our pipeline is buffer-based). Returns a document with `getBody()`, `getHeaders()`, `getFooters()`, `getFootnotes()`, `getEndnotes()`, `getTextboxes()`, with correct Unicode handling. Also reads `.docx`, which we will *not* use — mammoth stays the docx parser. Cons: no `.d.ts` (dynamic-import cast), last release 2021 — but the binary `.doc` format is frozen since 2007, so "stable" is a fair reading of "stale" here. |
| `textract` | — | 2019 | many | **requires `antiword`/`catdoc`** | Rejected — violates the no-system-binaries constraint. |
| `officeparser` | ~675k | active | 4 | none | Rejected — **does not support legacy `.doc`** at all. |
| Declare `.doc` unsupported | — | — | — | — | The honest fallback if `word-extractor` were unavailable, but it is available, maintained enough, dependency-light and widely used. **Rejecting a 474k-downloads pure-JS solution in favour of an error message would be the wrong trade.** |

**Recommendation: `word-extractor`**, behind a magic-byte guard (§6.4) so that a file
*labelled* `application/msword` but actually a zip (a common browser/OS mislabelling of
`.docx`) is transparently delegated to the existing `parseDocx`, and a file that is neither OLE
nor zip fails with an explicit message instead of a library stack trace.
**Fallback:** the explicit `UnsupportedDocumentFormatError` path, which is also what `.ppt`
gets (§2.3).

### 3.4 New dependencies summary

```jsonc
// apps/api/package.json → dependencies
"rtf-parser": "^1.3.3",      // RTF text extraction
"word-extractor": "^1.0.4",  // legacy binary .doc (OLE/CFB)
```

Neither package has native bindings, post-install scripts of consequence, or system
requirements. ODT adds **no** dependency. Docker image size impact: negligible (< 500 KB).

---

## 4. Target coverage

| Format | Mime types | Parser | `EnrichmentAssetKind` | Notes |
|---|---|---|---|---|
| RTF | `application/rtf`, `text/rtf` | `RtfParser.parseRtf` | **`rtf` (new)** | frontend `accept` gains `.rtf` |
| ODT | `application/vnd.oasis.opendocument.text` | `OdtParser.parseOdt` | **`odt` (new)** | frontend `accept` gains `.odt` |
| `.doc` legacy | `application/msword` | `LegacyDocParser.parseLegacyDoc` | `docx` (unchanged) | see §5.1 for why no new enum value |
| `.ppt` legacy | `application/vnd.ms-powerpoint` | `parsePptx` + guard | `pptx` (unchanged) | explicit unsupported error instead of a zip error |

---

## 5. Design decisions

### 5.1 Enum: add `rtf` and `odt`, keep `docx` for legacy `.doc`

`EnrichmentAssetKind` (`apps/api/src/domain/entities/AssetEnrichmentTrace.ts`) gains two
members: `"rtf"` and `"odt"`. They are user-visible — `renderAssetLayerDFragment()` prints
`Type: <assetKind>` into Layer D — so a wrong label degrades the prompt.

Legacy `.doc` deliberately keeps `assetKind: "docx"`: it *is* a Word document from Layer D's
point of view, the distinction that matters for diagnostics is already carried by
`provenance.parserName` (`word-extractor` vs `mammoth`), and adding a `"doc"` member would
force touching every `isDocumentKind`/`toMediaKind`/prompt branch for zero prompt value.
(Alternative, if diagnostics turn out to matter: add `"doc"` later — it is additive and
backwards compatible, existing traces just keep the old value.)

The type is **not** mirrored in `packages/contracts` (verified — no occurrence), so no
contract change is needed.

### 5.2 `DocumentBriefExtractor` needs no change

`buildDocumentBriefPrompt()` branches only on `isSpreadsheet` (`xlsx`/`csv`) and
`isPresentation` (`pptx`); every other kind falls into the generic prose-document branch,
which is exactly right for `rtf` and `odt`. The new kinds flow through as plain text +
`sectionCount`, identical to `docx`.

### 5.3 Consistency of the parser contract

Every new parser returns the same `ParsedDocument` (declared in `PdfParser.ts`), applies the
same `MAX_CHARS = 120_000` truncation and the same `MIN_TEXT_WARN_CHARS = 50` short-text
warning, and sets `parserName` / `parserVersion` so provenance stays meaningful. No parser
introduces new fields on `ParsedDocument`.

---

## 6. Implementation plan

Ordered so the tree compiles and tests pass after every step.

### Step 1 — `apps/api/package.json`

Add to `dependencies`: `"rtf-parser": "^1.3.3"`, `"word-extractor": "^1.0.4"`.
Run `npm install` from the repo root (workspaces). No lockfile surgery, no Dockerfile change.

### Step 2 — `apps/api/src/domain/entities/AssetEnrichmentTrace.ts`

Additive only:

```ts
export type EnrichmentAssetKind =
    | "pdf"
    | "docx"
    | "rtf"      // NEW — Rich Text Format
    | "odt"      // NEW — OpenDocument Text
    | "txt"
    …
```

`CURRENT_TRACE_VERSION` stays at `2`: no existing trace changes shape, so no re-enrichment
migration is required.

### Step 3 — `apps/api/src/application/documents/parsers/RtfParser.ts` (new)

Style reference: `PptxParser.ts` (dynamic import + cast, because `rtf-parser` ships no types).

```ts
import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

interface RtfSpan { value?: string }
interface RtfParagraph { content?: RtfSpan[] }
interface RtfDocument { content?: RtfParagraph[] }

/** Last-resort de-markup used when rtf-parser fails or yields nothing. */
function stripRtfMarkup(src: string): string {
    return src
        .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\s?\??/g, (_, n) => String.fromCharCode((Number(n) + 65536) % 65536))
        .replace(/\{\\\*?\\(fonttbl|colortbl|stylesheet|info|pict|object)[\s\S]*?\}/gi, " ")
        .replace(/\\par[d]?\b/gi, "\n")
        .replace(/\\[a-z]+-?\d*\s?/gi, "")
        .replace(/[{}]/g, "")
        .replace(/[ \t]+/g, " ");
}

export async function parseRtf(buffer: Buffer): Promise<ParsedDocument> {
    // rtf-parser has no type declarations — same dynamic-import cast PptxParser uses.
    const mod = await import("rtf-parser").catch(() => {
        throw new Error("rtf-parser package is required for RTF parsing — run npm install rtf-parser");
    });
    const parseString = ((mod as { default?: unknown }).default ?? mod) as {
        string(input: string, cb: (err: Error | null, doc?: RtfDocument) => void): void;
    };

    // latin1 keeps every byte 1:1 so \'xx codepage escapes survive to the parser.
    const source = buffer.toString("latin1");

    let paragraphs: string[] = [];
    try {
        const doc = await new Promise<RtfDocument>((resolve, reject) => {
            parseString.string(source, (err, d) =>
                err || !d ? reject(err ?? new Error("rtf-parser returned no document")) : resolve(d));
        });
        paragraphs = (doc.content ?? [])
            .map(p => (p.content ?? []).map(s => s.value ?? "").join(""))
            .map(t => t.replace(/\s+/g, " ").trim())
            .filter(Boolean);
    } catch (err) {
        console.warn("[RtfParser] rtf-parser failed, falling back to regex de-markup:", err);
    }

    if (paragraphs.length === 0) {
        paragraphs = stripRtfMarkup(source).split(/\n+/).map(t => t.trim()).filter(Boolean);
    }

    let rawText = paragraphs.join("\n").trim();
    if (rawText.length < MIN_TEXT_WARN_CHARS) console.warn("[RtfParser] extracted text suspiciously short");
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,
        sectionCount: paragraphs.length > 0 ? paragraphs.length : null,
        parserName: "rtf-parser",
        parserVersion: "1.3.3",
    };
}
```

### Step 4 — `apps/api/src/application/documents/parsers/OdtParser.ts` (new)

Style reference: `PptxParser.ts`, near-literally.

```ts
import * as cheerio from "cheerio";
import type { ParsedDocument } from "./PdfParser";

const MAX_CHARS = 120_000;

export async function parseOdt(buffer: Buffer): Promise<ParsedDocument> {
    const AdmZipModule = await import("adm-zip").catch(() => {
        throw new Error("adm-zip package is required for ODT parsing — run npm install adm-zip");
    });
    const AdmZip = (AdmZipModule.default ?? AdmZipModule) as unknown as new (input: Buffer) => {
        getEntries(): Array<{ entryName: string; getData(): Buffer }>;
    };

    const zip = new AdmZip(buffer);
    const contentEntry = zip.getEntries().find(e => e.entryName.toLowerCase() === "content.xml");
    if (!contentEntry) {
        return emptyResult();   // same shape PptxParser returns for an empty zip
    }

    const $ = cheerio.load(contentEntry.getData().toString("utf-8"), { xmlMode: true });

    const paragraphs: string[] = [];
    let headingCount = 0;
    // Document order is preserved by cheerio's multi-selector traversal.
    $("text\\:h, text\\:p").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (!text) return;
        if ((el as { tagName?: string }).tagName?.toLowerCase() === "text:h") headingCount++;
        paragraphs.push(text);
    });

    let rawText = paragraphs.join("\n").trim();
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);
    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: null,                                    // ODT has no fixed pagination
        sectionCount: headingCount > 0 ? headingCount : (paragraphs.length || null),
        parserName: "odt-parser",
        parserVersion: "1.0.0",
    };
}
```

Note: `<text:p>` nested inside tables/frames/list items is matched too — that is desirable
(we want the text) and cannot double-count, since `text:p` never nests inside `text:p`.

### Step 5 — `apps/api/src/application/documents/parsers/LegacyDocParser.ts` (new)

```ts
import type { ParsedDocument } from "./PdfParser";
import { parseDocx } from "./DocxParser";

const MAX_CHARS = 120_000;
const MIN_TEXT_WARN_CHARS = 50;

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export function isOleCompoundFile(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).equals(OLE_MAGIC);
}
export function isZipPackage(buffer: Buffer): boolean {
    return buffer.subarray(0, 4).equals(ZIP_MAGIC);
}

/**
 * application/msword covers BOTH the legacy OLE binary .doc and files that
 * browsers/OSes mislabel (a real .docx sent as application/msword). Sniff the
 * magic bytes and route accordingly — mammoth cannot read OLE, word-extractor
 * is the pure-JS reader for it.
 */
export async function parseLegacyDoc(buffer: Buffer): Promise<ParsedDocument> {
    if (isZipPackage(buffer)) return parseDocx(buffer);          // mislabelled .docx

    if (!isOleCompoundFile(buffer)) {
        throw new Error(
            "Unsupported Word file: the attachment is neither an OLE (.doc) nor an OOXML (.docx) document.",
        );
    }

    const mod = await import("word-extractor").catch(() => {
        throw new Error("word-extractor package is required for legacy .doc parsing — run npm install word-extractor");
    });
    const WordExtractor = ((mod as { default?: unknown }).default ?? mod) as new () => {
        extract(input: Buffer): Promise<{ getBody(): string; getFootnotes(): string; getEndnotes(): string }>;
    };

    const doc = await new WordExtractor().extract(buffer);
    let rawText = [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
        .filter(part => part && part.trim().length > 0)
        .join("\n\n")
        .replace(/\x00/g, "")
        .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")       // same sanitation as PdfParser
        .trim();

    if (rawText.length < MIN_TEXT_WARN_CHARS) console.warn("[LegacyDocParser] extracted text suspiciously short");
    if (rawText.length > MAX_CHARS) rawText = rawText.slice(0, MAX_CHARS);

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;
    const sectionCount = (rawText.match(/\n{2,}/g) ?? []).length + (rawText ? 1 : 0);

    return {
        rawText, charCount: rawText.length, wordCount,
        pageCount: null,
        sectionCount: sectionCount > 0 ? sectionCount : null,
        parserName: "word-extractor",
        parserVersion: "1.0.4",
    };
}
```

### Step 6 — `DocumentParserFactory.ts` (map 1 of 4)

```ts
import { parseRtf } from "./RtfParser";
import { parseOdt } from "./OdtParser";
import { parseLegacyDoc } from "./LegacyDocParser";

// .doc is the legacy OLE binary format — mammoth only reads OOXML .docx,
// so it gets its own parser (which delegates back to parseDocx on mislabelled zips).
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const LEGACY_DOC_MIMES = new Set(["application/msword"]);
const RTF_MIMES = new Set(["application/rtf", "text/rtf", "text/richtext"]);
const ODT_MIMES = new Set(["application/vnd.oasis.opendocument.text"]);
```

and, in `getParser()`, immediately after the `DOCX_MIMES` branch:

```ts
if (LEGACY_DOC_MIMES.has(mime)) return { parse: (buf) => parseLegacyDoc(buf) };
if (RTF_MIMES.has(mime))        return { parse: (buf) => parseRtf(buf) };
if (ODT_MIMES.has(mime))        return { parse: (buf) => parseOdt(buf) };
```

> **Ordering caution:** `RTF_MIMES` must be tested **before** `PLAIN_MIMES` is ever widened —
> `text/rtf` starts with `text/` and would otherwise be a candidate for the plain-text branch.
> With the current sets there is no overlap, but the branch order above keeps it safe.

Optional in the same step (§2.3): inside the `PPTX_MIMES` branch, reject binary `.ppt` early —

```ts
if (PPTX_MIMES.has(mime)) {
    return { parse: (buf) => {
        if (isOleCompoundFile(buf)) {
            return Promise.reject(new Error(
                "Legacy binary .ppt (PowerPoint 97-2003) is not supported — please re-save as .pptx or PDF.",
            ));
        }
        return parsePptx(buf);
    } };
}
```

### Step 7 — `EnrichmentKindDetector.ts` (map 2 of 4) — **must ship in the same commit as Step 6**

```ts
const DOCX_MIMES = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",           // kept: legacy .doc still reports assetKind "docx" (§5.1)
]);
const RTF_MIMES = new Set(["application/rtf", "text/rtf", "text/richtext"]);
const ODT_MIMES = new Set(["application/vnd.oasis.opendocument.text"]);
```

```ts
if (RTF_MIMES.has(mime)) return "rtf";
if (ODT_MIMES.has(mime)) return "odt";
```

⚠️ `if (RTF_MIMES.has(mime))` must come **before** the `mime === "text/plain"` /
`PLAIN_MIMES` checks for the same reason as above.

Extend `isDocumentKind()` — **without this the parser never runs**:

```ts
export function isDocumentKind(kind: EnrichmentAssetKind): boolean {
    return kind === "pdf" || kind === "docx" || kind === "rtf" || kind === "odt"
        || kind === "txt" || kind === "md" || kind === "html"
        || kind === "xlsx" || kind === "csv" || kind === "pptx";
}
```

### Step 8 — `AssetEnrichmentPipeline.ts` — one-line map fix

`toMediaKind()` currently maps `pdf|docx|txt|md|html|xlsx|csv` to `"document"` and everything
else to `"reference"` — meaning **`pptx` is already mis-labelled `reference` today**. Add the
new kinds and fix `pptx` in the same edit:

```ts
if (kind === "pdf" || kind === "docx" || kind === "rtf" || kind === "odt"
    || kind === "txt" || kind === "md" || kind === "html"
    || kind === "xlsx" || kind === "csv" || kind === "pptx") return "document";
```

### Step 9 — `apps/api/src/application/use-cases/UploadProjectAsset.ts` (map 3 of 4)

Add to `ALLOWED_MIME_EXACT`:

```ts
// RTF
"application/rtf",
"text/richtext",
// OpenDocument Text
"application/vnd.oasis.opendocument.text",
```

(`text/rtf` already passes through the `text/` prefix rule, but listing `application/rtf`
is mandatory — it is the mime Chrome and Firefox send for `.rtf` on Windows and macOS.)

### Step 10 — `apps/web/components/dashboard/VibeCoreEntry.tsx` (map 4 of 4)

In `ACCEPTED_MIME_TYPES` (documents block):

```ts
"application/rtf",
"text/rtf",
"text/richtext",
"application/vnd.oasis.opendocument.text",
```

And the file input `accept` attribute (~line 915):

```tsx
accept=".pdf,.docx,.doc,.rtf,.odt,.txt,.md,.html,.csv,.xlsx,.xls,.pptx,.ppt,image/*"
```

Recommended hardening in the same edit (`addFiles`, ~line 431): some OS/browser combinations
report an **empty** `file.type` for `.rtf`/`.odt`. Accept by extension when the mime is blank:

```ts
const ACCEPTED_EXTENSIONS = [".rtf", ".odt"];
const isAccepted = (f: File) =>
    ACCEPTED_MIME_TYPES.includes(f.type)
    || (f.type === "" && ACCEPTED_EXTENSIONS.some(ext => f.name.toLowerCase().endsWith(ext)));
```

For consistency (optional, same PR, zero-risk string edits) the other three `accept`
attributes should get `.rtf,.odt` too:
`apps/web/app/workspace/[projectId]/page.tsx:3215`,
`apps/web/app/launch/[projectId]/page.tsx:1344`,
`apps/web/components/ProjectConfigPopup.tsx:646`.

---

## 7. Tests

Pattern reference: `apps/api/src/application/documents/parsers/__tests__/` (vitest,
`describe`/`it`/`expect`, fixtures built in-memory — `PptxParser.test.ts` builds its zip with
`adm-zip` rather than committing a binary fixture; do the same for ODT).

### 7.1 `__tests__/DocumentParserFactory.test.ts` (extend)

```ts
it("returns a parser for application/rtf", () => expect(getParser("application/rtf")).not.toBeNull());
it("returns a parser for text/rtf", () => expect(getParser("text/rtf")).not.toBeNull());
it("returns a parser for odt mime", () =>
    expect(getParser("application/vnd.oasis.opendocument.text")).not.toBeNull());
it("still returns a parser for application/msword", () =>
    expect(getParser("application/msword")).not.toBeNull());
it("returns null for odp/ods (not supported yet)", () => {
    expect(getParser("application/vnd.oasis.opendocument.presentation")).toBeNull();
    expect(getParser("application/vnd.oasis.opendocument.spreadsheet")).toBeNull();
});
```

### 7.2 `__tests__/RtfParser.test.ts` (new)

Fixtures are plain RTF strings — no binary files needed.

- extracts text from a minimal document: `{\rtf1\ansi\b hi there\b0\par second line\par}`
  → `rawText` contains both lines, `sectionCount === 2`
- decodes `\'e9` (é) and `\u233?` unicode escapes correctly
- drops `{\fonttbl…}` / `{\colortbl…}` control groups from the output
- returns an empty, non-throwing result for a non-RTF buffer (regex fallback path)
- reports `parserName === "rtf-parser"`

### 7.3 `__tests__/OdtParser.test.ts` (new)

Build the fixture with `adm-zip`, mirroring `PptxParser.test.ts`:

```ts
function makeOdtBuffer(headings: string[], paragraphs: string[]): Buffer {
    const zip = new AdmZip();
    zip.addFile("mimetype", Buffer.from("application/vnd.oasis.opendocument.text"));
    zip.addFile("content.xml", Buffer.from(`<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
                         xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>
    ${headings.map(h => `<text:h>${h}</text:h>`).join("")}
    ${paragraphs.map(p => `<text:p>${p}</text:p>`).join("")}
  </office:text></office:body>
</office:document-content>`, "utf-8"));
    return zip.toBuffer();
}
```

- extracts heading + paragraph text in document order
- `sectionCount` equals the number of `text:h` elements
- empty zip / missing `content.xml` → `rawText === ""`, `wordCount === 0`, no throw
- `parserName === "odt-parser"`

### 7.4 `__tests__/LegacyDocParser.test.ts` (new)

- a zip-magic buffer is delegated to `parseDocx` (assert `parserName === "mammoth"`) — use a
  real minimal docx built with `adm-zip`, or spy on `parseDocx`
- a buffer that is neither OLE nor zip rejects with the explicit
  "Unsupported Word file" message (**not** a zip stack trace)
- `isOleCompoundFile` / `isZipPackage` magic-byte helpers unit-tested directly

A real `.doc` binary fixture cannot be built in-memory. **As implemented:** the zip-delegation
and rejection paths are covered with `vi.mock("../DocxParser")`; the `word-extractor` happy
path (a genuine OLE `.doc` → real text) is left to manual verification (§8) rather than
committing a binary fixture — no small representative `.doc` sample was available at
implementation time. Revisit if a suitable fixture becomes available.

### 7.5 `__tests__/mimeCoverage.parity.test.ts` (new) — anti-drift guard

Direct mitigation of §2.4. One table, three assertions:

```ts
const DOCUMENT_MIMES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/rtf", "text/rtf",
    "application/vnd.oasis.opendocument.text",
    "text/plain", "text/markdown", "text/html",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

it.each(DOCUMENT_MIMES)("%s has a parser, a known kind, and is a document kind", (mime) => {
    expect(getParser(mime)).not.toBeNull();
    const kind = detectEnrichmentKind(mime);
    expect(kind).not.toBe("unknown");
    expect(isDocumentKind(kind)).toBe(true);
});
```

**As implemented:** the optional fourth assertion (importing `isAllowedMime` from
`UploadProjectAsset.ts`) was dropped — that module imports `config.ts`, which calls
`process.exit(1)` when `MONGODB_URI`/JWT secrets are absent, which is the default state of
this unit-test process. Touching `config.ts`'s fail-fast behavior was out of scope. The upload
allowlist entries (Step 9) are covered by manual verification (§8) instead.

---

## 8. Manual verification

Local dev stack (`docs/guides/LOCAL_DOCKER_START.md`), not the deploy stack:

1. From the dashboard VibeCore box, attach one `.rtf`, one `.odt` and one real legacy `.doc`
   (saved from Word 97-2003 or LibreOffice "Word 97-2003") with a short prompt.
2. `GET /v1/projects/:id/assets/:assetId` → assert per asset
   `enrichmentTrace.provenance.enrichmentStatus === "ready"`,
   `provenance.parserName` ∈ {`rtf-parser`, `odt-parser`, `word-extractor`},
   `textLayer.wordCount > 0`, `documentBrief.purposeSentence` non-empty.
3. Open the prompt trace of the generation and confirm the Layer D fragment carries
   `Type: rtf` / `Type: odt` and a coherent summary.
4. Negative path: attach a legacy `.ppt` → the trace must be `failed` with the explicit
   "not supported — please re-save as .pptx or PDF" message, not a zip error.

---

## 9. Is the extraction engine adequate for the use case?

Targeted assessment, as requested — not a re-audit of the pipeline.

### 9.1 Quality parity of the new formats

The pipeline's value chain is: **parser → `rawText` + `sectionCount` → `DocumentBriefExtractor`
LLM → `documentBrief` → Layer D fragment**. Everything downstream of `rawText` is
format-agnostic, so extraction quality is entirely a function of the parser's text fidelity.

| Format | Expected fidelity vs current baseline | Reasoning |
|---|---|---|
| ODT | **Equal to DOCX/PPTX** | Same class of work (zip + XML text nodes) with a cleaner source: `content.xml` marks headings explicitly (`text:h`), so `sectionCount` is *more* accurate than `DocxParser`'s (which reports `null`). |
| RTF | **Equal to DOCX for prose, slightly below for exotic documents** | `rtf-parser` reconstructs paragraphs and spans and decodes codepage/unicode escapes. Weak spots are embedded objects, complex tables and drawing groups — content types that also degrade in the DOCX path. The regex fallback only engages on parser failure and yields "readable but unstructured" text, which is still enough for the brief LLM. |
| `.doc` legacy | **Equal to DOCX** | `word-extractor` reads the Word binary text streams (body + notes + textboxes) with correct Unicode. Compared with today's behaviour (total failure) this is an unqualified improvement. |

For the *"no-code synthesis of a digital artifact from a micro-prompt + attachments"* use case,
what Layer D actually consumes is a **distilled brief** (purpose, key messages, tone, audience,
topics) — not a faithful reproduction of the document. Paragraph-level plain text is therefore
sufficient, and the three new parsers all clear that bar. No format-specific prompt work is
needed (§5.2).

### 9.2 Formats still uncovered after this plan

| Format | Priority | Note |
|---|---|---|
| `.odp` / `.ods` | Low | Same zip+XML technique (`content.xml`, `draw:page` / `table:table`). Deferrable: real-world Zero Effort attachments are overwhelmingly PDF/DOCX/images. If added, `.odp` should map to a new `odp` kind rather than reuse `pptx`, and `.ods` should route to a `sheets`-producing parser so the spreadsheet prompt branch applies. |
| `.pages`, `.key`, `.numbers` (Apple iWork) | Low | Proprietary zip with a binary IWA payload; no viable pure-JS extractor. Correct answer is an explicit unsupported message. |
| Scanned image-only PDFs | Medium | Parses "successfully" with near-zero text (§2.2). Needs OCR or a vision fallback — genuinely out of scope. |
| `.epub`, `.msg`, `.eml` | Low | No demand observed. |

### 9.3 Structural verdict

The engine architecture (one parser per format behind a single `DocumentParser` interface, a
uniform `ParsedDocument`, one LLM distillation pass, one pre-rendered Layer D fragment) is
sound and scales to the new formats without modification. The weaknesses that remain are
**operational** (§10), not architectural — and none of them are made worse by this plan.

---

## 10. Rischi noti fuori scope

Already diagnosed with the product owner in a previous session. Listed here only so they stay
visible; **no change is proposed for them in this plan.**

1. **Readiness polling covers only "structured" mime types.**
   `waitForStructuredAssetReadiness()` in `apps/web/components/dashboard/VibeCoreEntry.tsx`
   is driven by `STRUCTURED_DATA_MIME_TYPES` (json / csv / xlsx / xml / sql). Generic documents
   — docx, pdf, pptx, and the new rtf/odt/doc — are **not** waited on, so the Zero Effort
   prefill call can fire before their enrichment trace is ready and generate with a partially
   empty Layer D. If the polling set is ever widened, the new mime types must be added there
   too (it would become a *fifth* map to keep in sync).
2. **No timeout and no retry on the enrichment LLM calls.**
   `DocumentBriefExtractor.ts` calls the provider with a bare `fetch` — verified: no
   `AbortSignal`, no timeout, no retry. A hanging provider stalls a background enrichment
   indefinitely; a single transient 5xx loses the brief (the pipeline does degrade gracefully,
   keeping `textLayer` + `structuredData` and still marking the trace `ready`).
3. **Short-text PDFs are indistinguishable from good ones on the trace** (§2.2) — the
   "suspiciously short / probably scanned" signal exists only in the server log.

---

## 11. Acceptance criteria

- [ ] `.rtf`, `.odt` and a real legacy `.doc` can be attached from the VibeCore entry box
- [ ] Each produces a trace with `enrichmentStatus: "ready"`, non-empty `textLayer` and a
      populated `documentBrief`
- [ ] `provenance.parserName` correctly identifies the parser used
- [ ] Layer D shows `Type: rtf` / `Type: odt` and a coherent summary
- [ ] Legacy `.ppt` fails with an explicit, user-actionable message
- [ ] The parity test (§7.5) is green and would go red if any of the four maps drifted
- [ ] `npm run test` green in `apps/api`; no change to `CURRENT_TRACE_VERSION`
- [ ] No new system dependency in the Docker image

## 12. Delivery

Branch: `feat/document-format-coverage` from `develop`, per
`docs/guides/GITFLOW_RELEASE_POLICY.md`. Suggested commit split:
(1) deps + enum + three parsers + parser tests;
(2) the four mime maps + parity test;
(3) frontend accept lists;
(4) this document's status flip to `Implemented`.
