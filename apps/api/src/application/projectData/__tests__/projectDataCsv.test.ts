import { describe, it, expect } from "vitest";
import { CSV_BOM, csvTextCell, csvValueCell, encodeProjectDataCsv } from "../projectDataCsv";
import type { ProjectDataRecord } from "../../../domain/projectData/ProjectDataCapability";

const at = new Date("2026-11-25T10:00:00.000Z");

function record(id: string, data: Record<string, unknown>, groupId = "default"): ProjectDataRecord {
    return { id, groupId, createdAt: at, data };
}

function lines(csv: string): string[] {
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    return csv.slice(CSV_BOM.length, -2).split("\r\n");
}

describe("project data CSV", () => {
    it("quotes per RFC 4180 only when needed, doubling inner quotes", () => {
        expect(csvTextCell("plain")).toBe("plain");
        expect(csvTextCell("a,b")).toBe('"a,b"');
        expect(csvTextCell('say "hi"')).toBe('"say ""hi"""');
        expect(csvTextCell("two\nlines")).toBe('"two\nlines"');
        expect(csvTextCell("cr\rhere")).toBe('"cr\rhere"');
        expect(csvTextCell("")).toBe("");
    });

    it("neutralises spreadsheet formulas in text cells", () => {
        expect(csvTextCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
        expect(csvTextCell("+1")).toBe("'+1");
        expect(csvTextCell("-2")).toBe("'-2");
        expect(csvTextCell("@cmd")).toBe("'@cmd");
        expect(csvTextCell("\tTAB")).toBe("'\tTAB");
        expect(csvTextCell("\r=X")).toBe("\"'\r=X\"");
        // Prefix first, then quoting: the quote wraps the escaped text.
        expect(csvTextCell('=HYPERLINK("http://x.test","x")')).toBe('"\'=HYPERLINK(""http://x.test"",""x"")"');
        expect(csvTextCell("a=b")).toBe("a=b");
    });

    it("keeps numbers and booleans as they are, JSON-encodes nested values, empties null", () => {
        expect(csvValueCell(-5)).toBe("-5");
        expect(csvValueCell(1.5)).toBe("1.5");
        expect(csvValueCell(true)).toBe("true");
        expect(csvValueCell(null)).toBe("");
        expect(csvValueCell(undefined)).toBe("");
        expect(csvValueCell({ a: 1, b: "x" })).toBe('"{""a"":1,""b"":""x""}"');
        expect(csvValueCell(["x", "y"])).toBe('"[""x"",""y""]"');
        expect(csvValueCell(new Date("2026-01-02T03:04:05.000Z"))).toBe("2026-01-02T03:04:05.000Z");
    });

    it("writes id, group, createdAt, then the union of top-level data keys in first-seen order", () => {
        const csv = encodeProjectDataCsv([
            record("r1", { player: "ANA", score: 10 }),
            record("r2", { score: 20, extra: { nested: [1, 2] } }, "speedrun"),
        ]);
        expect(lines(csv)).toEqual([
            "id,group,createdAt,player,score,extra",
            "r1,default,2026-11-25T10:00:00.000Z,ANA,10,",
            'r2,speedrun,2026-11-25T10:00:00.000Z,,20,"{""nested"":[1,2]}"',
        ]);
    });

    it("escapes header cells too, and keeps a data key that collides with a base column", () => {
        const csv = encodeProjectDataCsv([record("r1", { "=evil": "x", id: "visitor-id" })]);
        expect(lines(csv)).toEqual([
            "id,group,createdAt,'=evil,data.id",
            "r1,default,2026-11-25T10:00:00.000Z,x,visitor-id",
        ]);
    });

    it("writes only the header when there is nothing to export", () => {
        expect(lines(encodeProjectDataCsv([]))).toEqual(["id,group,createdAt"]);
    });
});
