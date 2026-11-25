import type { ProjectDataRecord } from "../../domain/projectData/ProjectDataCapability";

/**
 * CSV export of project data (docs/specs/PROJECT_DATA_PANEL.md "Export format").
 *
 * - Columns: `id`, `group`, `createdAt`, then every top-level key of `data`, in first-seen order.
 * - Nested values (objects, arrays) are JSON-encoded into their cell; null/undefined are empty.
 * - RFC 4180: CRLF line endings; a cell containing `"`, `,`, CR or LF is quoted, quotes doubled.
 * - Spreadsheet formula injection: a text cell starting with `=`, `+`, `-`, `@`, TAB or CR is
 *   prefixed with `'` so a spreadsheet shows it as text instead of evaluating it. Numbers and
 *   booleans are never prefixed (a negative score is a number, not a formula). Header cells are
 *   text too — a capability's data keys may come from a visitor (form field names).
 * - A UTF-8 byte order mark leads the file, so spreadsheet apps read accented text correctly.
 */
export const CSV_BOM = "﻿";
const BASE_COLUMNS = ["id", "group", "createdAt"] as const;
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvTextCell(text: string): string {
    const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvValueCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
    if (value instanceof Date) return csvTextCell(value.toISOString());
    if (typeof value === "string") return csvTextCell(value);
    return csvTextCell(JSON.stringify(value) ?? "");
}

export function encodeProjectDataCsv(records: readonly ProjectDataRecord[]): string {
    const dataKeys = new Set<string>();
    for (const record of records) {
        for (const key of Object.keys(record.data)) dataKeys.add(key);
    }
    // A data key equal to a base column name ("id", "group", "createdAt") is kept under a "data."
    // prefix rather than silently colliding with, or dropped in favour of, the base column.
    const headerOf = (key: string) => ((BASE_COLUMNS as readonly string[]).includes(key) ? `data.${key}` : key);

    const header = [...BASE_COLUMNS, ...[...dataKeys].map(headerOf)].map(csvTextCell).join(",");
    const rows = records.map((record) => [
        csvTextCell(record.id),
        csvTextCell(record.groupId),
        csvTextCell(record.createdAt.toISOString()),
        ...[...dataKeys].map((key) => csvValueCell(record.data[key])),
    ].join(","));
    return CSV_BOM + [header, ...rows].join("\r\n") + "\r\n";
}
