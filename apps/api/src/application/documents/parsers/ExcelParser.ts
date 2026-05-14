import type { ParsedDocument, ParsedDocumentSheet } from "./PdfParser";

const MAX_CHARS = 120_000;
const MAX_SHEET_CSV_CHARS = 30_000;
const SAMPLE_ROW_COUNT = 25;

function inferColumnType(values: unknown[]): string {
    const nonEmpty = values.filter(v => v !== "" && v !== null && v !== undefined);
    if (nonEmpty.length === 0) return "unknown";

    const numericRatio = nonEmpty.filter(v => typeof v === "number").length / nonEmpty.length;
    if (numericRatio >= 0.8) return "number";

    if (nonEmpty.every(v => v instanceof Date)) return "date";

    const strings = nonEmpty.map(v => String(v));
    const boolRatio = strings.filter(v => /^(true|false|yes|no|y|n|sì|si)$/i.test(v.trim())).length / strings.length;
    if (boolRatio >= 0.8) return "boolean";

    const dateRatio = strings.filter(v => !isNaN(Date.parse(v)) && /\d{2,4}/.test(v)).length / strings.length;
    if (dateRatio >= 0.7) return "date";

    return "text";
}

export async function parseExcel(buffer: Buffer): Promise<ParsedDocument> {
    const XLSX: typeof import("xlsx") = await import("xlsx").catch(() => {
        throw new Error("xlsx package is required for Excel parsing — run npm install xlsx");
    });

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    const textParts: string[] = [];
    const sheets: ParsedDocumentSheet[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;

        // raw: true (default) preserves native types: numbers as JS numbers,
        // dates as Date objects (since we passed cellDates:true to XLSX.read)
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
            defval: "",
        });

        const firstRow = jsonRows[0];
        const columnHeaders = firstRow ? Object.keys(firstRow) : [];
        const rowCount = jsonRows.length;

        // Infer column types from first 20 data rows
        const columnTypes: string[] = columnHeaders.map(header => {
            const vals = jsonRows.slice(0, 20).map(r => r[header]);
            return inferColumnType(vals);
        });

        // Sample rows as string arrays (first SAMPLE_ROW_COUNT rows)
        const sampleRows: string[][] = jsonRows.slice(0, SAMPLE_ROW_COUNT).map(row =>
            columnHeaders.map(h => {
                const v = row[h];
                return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "");
            })
        );

        // Full CSV for rawText accumulation; truncated CSV block for LayerD injection
        const csvFull = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        const csvBlock = csvFull.length > MAX_SHEET_CSV_CHARS
            ? `${csvFull.slice(0, MAX_SHEET_CSV_CHARS)}\n...(truncated — ${rowCount} total rows)`
            : csvFull;

        sheets.push({ name: sheetName, rowCount, columnHeaders, columnTypes, sampleRows, csvBlock });

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
        parserName: "xlsx-sheetjs",
        parserVersion: "1.0.0",
        sheets,
    };
}
