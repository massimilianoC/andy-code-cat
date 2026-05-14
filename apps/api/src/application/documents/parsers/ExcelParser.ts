import type { ParsedDocument, ParsedDocumentSheet } from "./PdfParser";

const MAX_CHARS = 120_000;
const MAX_SHEET_CSV_CHARS = 30_000;
const SAMPLE_ROW_COUNT = 25;
const MAX_DATA_ROWS_IN_CSV = 500;
const MAX_REAL_COLUMNS = 40;

/**
 * Headers SheetJS auto-generates when a cell has no header (formatting bleeds
 * to far-right Excel columns, merged cells, blank header row, etc.). They
 * carry no information and bloat the CSV with thousands of trailing commas.
 *
 * SheetJS uses several conventions across versions / sheet contexts:
 *   - "" (empty string) — first unnamed column when header cell is blank
 *   - "_1", "_2", ...   — subsequent unnamed columns in aoa_to_sheet workbooks
 *   - "__EMPTY", "__EMPTY_1", ... — common in workbooks with merged cells or
 *     formatting that extends past the header row (PROPOSTE ZOE 2026.XLSX shape)
 *   - "EMPTY", "EMPTY_1", ... — observed in some older SheetJS outputs
 */
function isGhostHeader(header: string): boolean {
    if (header === "") return true;
    if (/^_\d+$/.test(header)) return true;
    if (/^__EMPTY(_\d+)?$/.test(header)) return true;
    if (/^EMPTY(_\d+)?$/.test(header)) return true;
    // Auto-generated column-letter style (A, B, ...) appears only when SheetJS
    // is given an explicit empty header row; we keep these because real users
    // sometimes use single-letter column names. Filter rejection happens only
    // when the column is also empty (handled by selectRealColumns).
    return false;
}

function inferColumnType(values: unknown[]): string {
    const nonEmpty = values.filter((v) => v !== "" && v !== null && v !== undefined);
    if (nonEmpty.length === 0) return "unknown";

    const numericRatio = nonEmpty.filter((v) => typeof v === "number").length / nonEmpty.length;
    if (numericRatio >= 0.8) return "number";

    if (nonEmpty.every((v) => v instanceof Date)) return "date";

    const strings = nonEmpty.map((v) => String(v));
    const boolRatio = strings.filter((v) => /^(true|false|yes|no|y|n|sì|si)$/i.test(v.trim())).length / strings.length;
    if (boolRatio >= 0.8) return "boolean";

    const dateRatio = strings.filter((v) => !isNaN(Date.parse(v)) && /\d{2,4}/.test(v)).length / strings.length;
    if (dateRatio >= 0.7) return "date";

    return "text";
}

function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return "";
    let s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    if (s.length === 0) return "";
    if (/[",\n\r]/.test(s)) {
        s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Build the canonical column list for a sheet by filtering out SheetJS's ghost
 * `__EMPTY*` headers and keeping only meaningful, named columns.
 *
 * Also keeps a column even if every cell is empty as long as its header is
 * meaningful — empty data columns can still be informative (e.g. "notes").
 */
function selectRealColumns(allHeaders: string[], jsonRows: Record<string, unknown>[]): string[] {
    const real = allHeaders.filter((h) => !isGhostHeader(h));
    // Defensive: if the user's sheet has more than MAX_REAL_COLUMNS named
    // columns we keep the first N to bound prompt size.
    if (real.length <= MAX_REAL_COLUMNS) return real;

    // Score by data density to keep the most informative columns.
    const scored = real.map((h) => {
        const nonEmpty = jsonRows.filter((r) => {
            const v = r[h];
            return v !== "" && v !== null && v !== undefined;
        }).length;
        return { header: h, density: nonEmpty };
    });
    scored.sort((a, b) => b.density - a.density);
    return scored.slice(0, MAX_REAL_COLUMNS).map((s) => s.header);
}

export async function parseExcel(buffer: Buffer, mimeType?: string): Promise<ParsedDocument> {
    const XLSX: typeof import("xlsx") = await import("xlsx").catch(() => {
        throw new Error("xlsx package is required for Excel parsing — run npm install xlsx");
    });

    // CSV files don't have magic bytes — SheetJS needs the explicit "string" path
    // to parse them deterministically. Excel files go through the buffer path.
    const isCsv = mimeType === "text/csv" || mimeType === "application/csv";
    const workbook = isCsv
        ? XLSX.read(buffer.toString("utf8"), { type: "string", cellDates: true, raw: false })
        : XLSX.read(buffer, { type: "buffer", cellDates: true });

    const textParts: string[] = [];
    const sheets: ParsedDocumentSheet[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: "",
        });

        const firstRow = jsonRows[0];
        const allHeaders = firstRow ? Object.keys(firstRow) : [];
        const columnHeaders = selectRealColumns(allHeaders, jsonRows);
        const rowCount = jsonRows.length;

        // Drop rows that are entirely empty across the real columns — these
        // appear when XLSX has decorative trailing rows or section gaps.
        const realRows = jsonRows.filter((row) =>
            columnHeaders.some((h) => {
                const v = row[h];
                return v !== "" && v !== null && v !== undefined;
            }),
        );

        const columnTypes: string[] = columnHeaders.map((header) => {
            const vals = realRows.slice(0, 20).map((r) => r[header]);
            return inferColumnType(vals);
        });

        const sampleRows: string[][] = realRows.slice(0, SAMPLE_ROW_COUNT).map((row) =>
            columnHeaders.map((h) => {
                const v = row[h];
                return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
            }),
        );

        // Build the CSV ourselves from the real columns + real rows. Using
        // XLSX.sheet_to_csv emits all 16 384 Excel columns when the sheet has
        // cells extending to the right edge, producing thousands of trailing
        // commas per row that drown the LLM prompt.
        const csvLines: string[] = [];
        csvLines.push(columnHeaders.map(csvEscape).join(","));
        for (const row of realRows.slice(0, MAX_DATA_ROWS_IN_CSV)) {
            csvLines.push(columnHeaders.map((h) => csvEscape(row[h])).join(","));
        }
        const csvFull = csvLines.join("\n");
        const csvBlock = csvFull.length > MAX_SHEET_CSV_CHARS
            ? `${csvFull.slice(0, MAX_SHEET_CSV_CHARS)}\n...(truncated — ${realRows.length} total data rows)`
            : csvFull;

        sheets.push({
            name: sheetName,
            rowCount: realRows.length,
            columnHeaders,
            columnTypes,
            sampleRows,
            csvBlock,
        });

        textParts.push(`[Sheet: ${sheetName}]`);
        textParts.push(csvFull);
    }

    let rawText = textParts.join("\n").trim();
    if (rawText.length > MAX_CHARS) {
        rawText = rawText.slice(0, MAX_CHARS);
    }

    const wordCount = rawText.trim().length > 0 ? rawText.trim().split(/\s+/).length : 0;

    return {
        rawText,
        charCount: rawText.length,
        wordCount,
        pageCount: workbook.SheetNames.length,
        sectionCount: workbook.SheetNames.length,
        parserName: isCsv ? "csv-sheetjs" : "xlsx-sheetjs",
        parserVersion: "1.2.0",
        sheets,
    };
}
