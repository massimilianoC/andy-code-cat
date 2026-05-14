import { describe, it, expect } from "vitest";
import { parseExcel } from "../ExcelParser";
import XLSX from "xlsx";

function makeXlsxBuffer(sheets: Record<string, (string | number)[][]>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of Object.entries(sheets)) {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return Buffer.from(XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as ArrayBuffer);
}

describe("ExcelParser", () => {
    it("extracts text from a single sheet", async () => {
        const buf = makeXlsxBuffer({ Sheet1: [["Name", "Age"], ["Alice", 30], ["Bob", 25]] });
        const result = await parseExcel(buf);

        expect(result.rawText).toContain("Name");
        expect(result.rawText).toContain("Alice");
        expect(result.rawText).toContain("Bob");
        expect(result.parserName).toBe("xlsx-sheetjs");
        expect(result.parserVersion).toBe("1.2.0");
    });

    it("parses a CSV buffer as a spreadsheet with structured payload", async () => {
        const csv = "Name,Genre,City\nAlice,Jazz,Milano\nBob,Rock,Roma\nClara,Pop,Napoli\n";
        const result = await parseExcel(Buffer.from(csv, "utf8"), "text/csv");

        expect(result.parserName).toBe("csv-sheetjs");
        expect(result.sheets).toBeDefined();
        expect(result.sheets?.length).toBe(1);
        const sheet = result.sheets![0]!;
        expect(sheet.columnHeaders).toEqual(["Name", "Genre", "City"]);
        expect(sheet.rowCount).toBe(3);
        expect(sheet.csvBlock).toContain("Alice");
        expect(sheet.csvBlock).toContain("Roma");
    });

    it("includes sheet names in text", async () => {
        const buf = makeXlsxBuffer({ MySheet: [["cell"]] });
        const result = await parseExcel(buf);
        expect(result.rawText).toContain("[Sheet: MySheet]");
    });

    it("reports pageCount and sectionCount as number of sheets", async () => {
        const buf = makeXlsxBuffer({ A: [["x"]], B: [["y"]], C: [["z"]] });
        const result = await parseExcel(buf);
        expect(result.pageCount).toBe(3);
        expect(result.sectionCount).toBe(3);
    });

    it("handles empty sheet gracefully", async () => {
        const buf = makeXlsxBuffer({ Empty: [[]] });
        const result = await parseExcel(buf);
        expect(result.wordCount).toBeGreaterThanOrEqual(0);
    });

    it("handles multiple sheets with content", async () => {
        const buf = makeXlsxBuffer({
            Revenue: [["Q1", "Q2"], [100, 200]],
            Costs: [["Q1", "Q2"], [50, 80]],
        });
        const result = await parseExcel(buf);
        expect(result.rawText).toContain("Revenue");
        expect(result.rawText).toContain("Costs");
    });

    // ── New: structured payload ──────────────────────────────────────────

    it("emits sheets array with correct sheet name and rowCount", async () => {
        const buf = makeXlsxBuffer({
            Products: [["Name", "Price", "Stock"], ["Widget", 9.99, 100], ["Gadget", 24.99, 40]],
        });
        const result = await parseExcel(buf);
        expect(result.sheets).toBeDefined();
        expect(result.sheets!.length).toBe(1);
        const sheet = result.sheets![0]!;
        expect(sheet.name).toBe("Products");
        expect(sheet.rowCount).toBe(2); // 2 data rows (header excluded)
    });

    it("emits correct columnHeaders for each sheet", async () => {
        const buf = makeXlsxBuffer({
            Data: [["ID", "Label", "Value"], [1, "Alpha", 10], [2, "Beta", 20]],
        });
        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        expect(sheet.columnHeaders).toEqual(["ID", "Label", "Value"]);
    });

    it("infers column types correctly for numeric columns", async () => {
        const buf = makeXlsxBuffer({
            Sales: [["Month", "Amount"], ["Jan", 1000], ["Feb", 2000], ["Mar", 1500]],
        });
        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        expect(sheet.columnTypes[1]).toBe("number"); // Amount column
    });

    it("emits sampleRows as string arrays", async () => {
        const buf = makeXlsxBuffer({
            Items: [["SKU", "Qty"], ["A001", 5], ["A002", 10]],
        });
        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        expect(sheet.sampleRows.length).toBe(2);
        expect(sheet.sampleRows[0]).toContain("A001");
    });

    it("emits csvBlock containing headers and data", async () => {
        const buf = makeXlsxBuffer({
            Orders: [["OrderId", "Customer"], ["O1", "Alice"], ["O2", "Bob"]],
        });
        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        expect(sheet.csvBlock).toContain("OrderId");
        expect(sheet.csvBlock).toContain("Alice");
    });

    it("emits structured sheets for each sheet in a multi-sheet workbook", async () => {
        const buf = makeXlsxBuffer({
            Sheet1: [["A", "B"], [1, 2]],
            Sheet2: [["X", "Y"], [3, 4]],
        });
        const result = await parseExcel(buf);
        expect(result.sheets!.length).toBe(2);
        expect(result.sheets!.map(s => s.name)).toEqual(["Sheet1", "Sheet2"]);
    });

    // ── Ghost-column filtering (Excel formatting bleed) ──────────────────

    it("filters out __EMPTY ghost columns produced by SheetJS when cells extend past the header row", async () => {
        // Simulate the PROPOSTE ZOE 2026.XLSX shape: 6 real columns,
        // then dozens of cells in row 1 with no header (formatting extends right).
        // SheetJS represents these as __EMPTY, __EMPTY_1, ...
        const realHeaders = ["artista", "provenienza", "genere", "link", "mail", "appunti"];
        const headerRow = [...realHeaders, ...Array(50).fill("")]; // 50 ghost cells
        const dataRow1 = ["Palmer Generator", "Ancona", "Post rock", "https://x.com", "p@x.it", "", ...Array(50).fill("")];
        const dataRow2 = ["Senzavolto", "Marotta", "Indie", "https://y.com", "s@y.it", "note", ...Array(50).fill("")];
        const buf = makeXlsxBuffer({ Foglio1: [headerRow, dataRow1, dataRow2] });

        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;

        expect(sheet.columnHeaders).toEqual(realHeaders);
        expect(sheet.columnHeaders.some((h) => h.startsWith("__EMPTY"))).toBe(false);
        expect(sheet.csvBlock).not.toMatch(/,,,,,,,/); // no long trailing-comma runs
        expect(sheet.csvBlock).toContain("Palmer Generator");
        expect(sheet.csvBlock).toContain("Senzavolto");
    });

    it("keeps CSV block compact (under MAX_SHEET_CSV_CHARS) even for sheets with many ghost columns", async () => {
        const realHeaders = ["a", "b"];
        const headerRow = [...realHeaders, ...Array(100).fill("")];
        const dataRows = Array.from({ length: 20 }, (_, i) => [
            `val_${i}`,
            i,
            ...Array(100).fill(""),
        ]);
        const buf = makeXlsxBuffer({ Big: [headerRow, ...dataRows] });

        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        // Without the ghost filter this would be > 100 commas per row × 21 rows = ~2100 chars
        // With the filter it's only 2 columns per row.
        expect(sheet.csvBlock.length).toBeLessThan(500);
        expect(sheet.columnHeaders).toEqual(realHeaders);
    });

    it("excludes fully-empty rows from rowCount and CSV (decorative trailing rows)", async () => {
        const buf = makeXlsxBuffer({
            Sheet1: [
                ["name", "value"],
                ["a", 1],
                ["b", 2],
                ["", ""],   // empty
                ["", ""],   // empty
            ],
        });
        const result = await parseExcel(buf);
        const sheet = result.sheets![0]!;
        expect(sheet.rowCount).toBe(2);
        expect(sheet.csvBlock.split("\n").length).toBe(3); // header + 2 data
    });
});
