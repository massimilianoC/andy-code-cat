import type {
    DatasetColumnProfile,
    DatasetColumnValueType,
    DatasetFactsEnvelope,
    DatasetStructuredData,
    DatasetTableProfile,
} from "../../domain/entities/AssetEnrichmentTrace";

export type DatasetPrimitive = string | number | boolean | null;
export type DatasetRow = Record<string, DatasetPrimitive>;

export interface NormalizedDatasetTable {
    name: string;
    sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
    rows: DatasetRow[];
    profile: DatasetTableProfile;
}

export interface NormalizedDataset {
    sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql";
    tables: NormalizedDatasetTable[];
    facts: DatasetFactsEnvelope;
    limitations: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function isNil(value: unknown): value is null | undefined | "" {
    return value === null || value === undefined || value === "";
}

function inferValueType(values: unknown[]): DatasetColumnValueType {
    const nonNull = values.filter((value) => !isNil(value));
    if (nonNull.length === 0) return "unknown";

    const numberRatio = nonNull.filter((value) => typeof value === "number" && Number.isFinite(value)).length / nonNull.length;
    if (numberRatio >= 0.8) return "number";

    const booleanRatio = nonNull.filter((value) => typeof value === "boolean").length / nonNull.length;
    if (booleanRatio >= 0.8) return "boolean";

    const strings = nonNull.map((value) => String(value).trim()).filter(Boolean);
    if (strings.length === 0) return "unknown";

    const dateRatio = strings.filter((value) => !Number.isNaN(Date.parse(value)) && /\d{2,4}/.test(value)).length / strings.length;
    if (dateRatio >= 0.7) return "date";

    return "string";
}

function toDatasetPrimitive(value: unknown, valueTypeHint?: DatasetColumnValueType): DatasetPrimitive {
    if (isNil(value)) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "boolean") return value;
    if (value instanceof Date) return value.toISOString();

    const text = String(value).trim();
    if (!text) return null;

    if (valueTypeHint === "number") {
        const normalized = text.replace(/\s/g, "").replace(",", ".");
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) return parsed;
    }

    if (valueTypeHint === "boolean") {
        if (/^(true|yes|y|si|sì)$/i.test(text)) return true;
        if (/^(false|no|n)$/i.test(text)) return false;
    }

    return text;
}

function formatSampleValue(value: DatasetPrimitive): string {
    if (value === null) return "null";
    return String(value);
}

function flattenJsonRecord(
    value: Record<string, unknown>,
    options?: {
        parentKey?: string;
        depth?: number;
        maxDepth?: number;
        limitations?: Set<string>;
    },
): Record<string, unknown> {
    const parentKey = options?.parentKey ?? "";
    const depth = options?.depth ?? 0;
    const maxDepth = options?.maxDepth ?? 3;
    const limitations = options?.limitations;
    const flat: Record<string, unknown> = {};

    for (const [key, current] of Object.entries(value)) {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;

        if (Array.isArray(current)) {
            flat[fullKey] = current.length;
            limitations?.add(`Nested arrays are summarized by item count in column "${fullKey}".`);
            continue;
        }

        if (isPlainObject(current)) {
            if (depth >= maxDepth) {
                flat[fullKey] = JSON.stringify(current);
                limitations?.add(`Nested object depth above ${maxDepth} is stringified starting from column "${fullKey}".`);
                continue;
            }
            Object.assign(
                flat,
                flattenJsonRecord(current, {
                    parentKey: fullKey,
                    depth: depth + 1,
                    maxDepth,
                    limitations,
                }),
            );
            continue;
        }

        flat[fullKey] = current;
    }

    return flat;
}

function collectXmlRecord(
    node: import("cheerio").Cheerio<any>,
    $: import("cheerio").CheerioAPI,
    limitations: Set<string>,
    options?: {
        parentKey?: string;
        depth?: number;
        maxDepth?: number;
    },
): Record<string, unknown> {
    const parentKey = options?.parentKey ?? "";
    const depth = options?.depth ?? 0;
    const maxDepth = options?.maxDepth ?? 3;
    const record: Record<string, unknown> = {};
    const element = node.get(0);
    if (!element) return record;

    for (const [key, value] of Object.entries(element.attribs ?? {})) {
        record[parentKey ? `${parentKey}.@${key}` : `@${key}`] = value;
    }

    const children = node.children().filter((_, child) => child.type === "tag");
    if (children.length === 0) {
        const text = node.text().replace(/\s+/g, " ").trim();
        if (text) {
            record[parentKey || element.tagName] = text;
        }
        return record;
    }

    const childTagNames = children.toArray().map((child) => child.tagName);
    const repeatedChildTags = new Set(childTagNames.filter((tag, index) => childTagNames.indexOf(tag) !== index));

    children.each((_, child) => {
        const childNode = $(child);
        const key = parentKey ? `${parentKey}.${child.tagName}` : child.tagName;
        if (repeatedChildTags.has(child.tagName)) {
            record[key] = childNode.length;
            limitations.add(`Repeated XML child nodes under "${key}" are summarized by count in the flattened dataset view.`);
            return;
        }

        if (depth >= maxDepth) {
            record[key] = childNode.text().replace(/\s+/g, " ").trim();
            limitations.add(`XML nesting deeper than ${maxDepth} is flattened as text starting from "${key}".`);
            return;
        }

        const childRecord = collectXmlRecord(childNode, $, limitations, {
            parentKey: key,
            depth: depth + 1,
            maxDepth,
        });
        Object.assign(record, childRecord);
    });

    return record;
}

function buildColumnProfile(columnKey: string, rawValues: unknown[]): DatasetColumnProfile {
    const valueType = inferValueType(rawValues);
    const values = rawValues.map((value) => toDatasetPrimitive(value, valueType));
    const nonNull = values.filter((value): value is Exclude<DatasetPrimitive, null> => value !== null);
    const distinct = new Set(nonNull.map((value) => String(value)));
    const sampleValues = [...distinct].slice(0, 5);
    const base: DatasetColumnProfile = {
        key: columnKey,
        label: columnKey,
        valueType,
        nonNullCount: nonNull.length,
        nullCount: values.length - nonNull.length,
        nullRatio: values.length > 0 ? Number(((values.length - nonNull.length) / values.length).toFixed(4)) : 0,
        distinctCount: distinct.size,
        sampleValues,
    };

    if (valueType === "number") {
        const nums = nonNull.filter((value): value is number => typeof value === "number");
        if (nums.length > 0) {
            const sum = nums.reduce((acc, value) => acc + value, 0);
            base.min = Math.min(...nums);
            base.max = Math.max(...nums);
            base.mean = Number((sum / nums.length).toFixed(4));
            base.sum = Number(sum.toFixed(4));
        }
    } else if (valueType === "date") {
        const dates = nonNull
            .map((value) => new Date(String(value)))
            .filter((date) => !Number.isNaN(date.getTime()))
            .sort((a, b) => a.getTime() - b.getTime());
        if (dates.length > 0) {
            base.min = dates[0]!.toISOString();
            base.max = dates[dates.length - 1]!.toISOString();
        }
    }

    return base;
}

function buildTableProfile(
    name: string,
    sourceFormat: "csv" | "xlsx" | "json" | "xml" | "sql",
    headers: string[],
    rows: DatasetRow[],
    notes?: string[],
): DatasetTableProfile {
    const columns = headers.map((header) => buildColumnProfile(header, rows.map((row) => row[header])));
    return {
        name,
        sourceFormat,
        rowCount: rows.length,
        columnCount: headers.length,
        columns,
        sampleHeaders: headers,
        sampleRows: rows.slice(0, 10).map((row) => headers.map((header) => formatSampleValue(row[header] ?? null))),
        notes,
    };
}

function aggregateFacts(tables: DatasetTableProfile[]): DatasetFactsEnvelope {
    const allColumns = tables.flatMap((table) => table.columns);
    return {
        rowCount: tables.reduce((acc, table) => acc + table.rowCount, 0),
        columnCount: allColumns.length,
        numericColumnCount: allColumns.filter((column) => column.valueType === "number").length,
        categoricalColumnCount: allColumns.filter((column) => column.valueType === "string" || column.valueType === "unknown").length,
        booleanColumnCount: allColumns.filter((column) => column.valueType === "boolean").length,
        dateColumnCount: allColumns.filter((column) => column.valueType === "date").length,
        supportedAggregations: ["count", "sum", "avg", "min", "max", "distinct_count", "top_values"],
    };
}

export function buildDatasetStructuredData(dataset: NormalizedDataset): DatasetStructuredData {
    return {
        sourceFormat: dataset.sourceFormat,
        tables: dataset.tables.map((table) => table.profile),
        facts: dataset.facts,
        limitations: dataset.limitations,
    };
}

async function readWorkbookTables(buffer: Buffer, sourceFormat: "csv" | "xlsx"): Promise<NormalizedDataset> {
    const XLSX: typeof import("xlsx") = await import("xlsx");
    const workbook = sourceFormat === "csv"
        ? XLSX.read(buffer.toString("utf8"), { type: "string", cellDates: true, raw: false })
        : XLSX.read(buffer, { type: "buffer", cellDates: true });

    const tables: NormalizedDatasetTable[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        const headers = Array.from(
            new Set(
                jsonRows.flatMap((row) => Object.keys(row).filter((key) => key && !/^__EMPTY/.test(key))),
            ),
        ).slice(0, 60);
        const rows: DatasetRow[] = jsonRows
            .map((row) => {
                const normalized: DatasetRow = {};
                for (const header of headers) {
                    normalized[header] = toDatasetPrimitive(row[header]);
                }
                return normalized;
            })
            .filter((row) => headers.some((header) => row[header] !== null));

        const notes = headers.length >= 60 ? ["Column list truncated to the first 60 detected columns."] : undefined;
        tables.push({
            name: sheetName,
            sourceFormat,
            rows,
            profile: buildTableProfile(sheetName, sourceFormat, headers, rows, notes),
        });
    }

    const tableProfiles = tables.map((table) => table.profile);
    return {
        sourceFormat,
        tables,
        facts: aggregateFacts(tableProfiles),
        limitations: [],
    };
}

function coerceJsonArray(records: unknown[], tableName: string, limitations: Set<string>): NormalizedDatasetTable {
    const objectRows = records.filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === "object" && !Array.isArray(record));
    const flattenedRows = objectRows.map((row) => flattenJsonRecord(row, { limitations }));
    const headers = Array.from(new Set(flattenedRows.flatMap((row) => Object.keys(row)))).slice(0, 60);
    const rows: DatasetRow[] = flattenedRows.map((row) => {
        const normalized: DatasetRow = {};
        for (const header of headers) {
            normalized[header] = toDatasetPrimitive(row[header]);
        }
        return normalized;
    });
    const notes = headers.length >= 60 ? ["Column list truncated to the first 60 detected fields."] : undefined;
    return {
        name: tableName,
        sourceFormat: "json",
        rows,
        profile: buildTableProfile(tableName, "json", headers, rows, notes),
    };
}

function readJsonTables(buffer: Buffer): NormalizedDataset {
    const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
    const tables: NormalizedDatasetTable[] = [];
    const limitations = new Set<string>();

    if (Array.isArray(parsed)) {
        tables.push(coerceJsonArray(parsed, "root", limitations));
    } else if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const arrayEntries = Object.entries(record).filter(([, value]) => Array.isArray(value));
        if (arrayEntries.length === 1) {
            tables.push(coerceJsonArray(arrayEntries[0]![1] as unknown[], arrayEntries[0]![0], limitations));
        } else if (arrayEntries.length > 1) {
            for (const [key, value] of arrayEntries) {
                tables.push(coerceJsonArray(value as unknown[], key, limitations));
            }
            limitations.add("Multiple JSON arrays detected; each array was exposed as a separate table.");
        } else {
            tables.push(coerceJsonArray([record], "root_object", limitations));
            limitations.add("JSON root is not an array; wrapped as a single-row table.");
        }
    } else {
        throw new Error("JSON dataset must be an array of records or an object containing array fields.");
    }

    return {
        sourceFormat: "json",
        tables,
        facts: aggregateFacts(tables.map((table) => table.profile)),
        limitations: [...limitations],
    };
}

async function readXmlTables(buffer: Buffer): Promise<NormalizedDataset> {
    const cheerio: typeof import("cheerio") = await import("cheerio");
    const raw = buffer.toString("utf8");
    const $ = cheerio.load(raw, { xmlMode: true });
    const root = $.root().children().filter((_, node) => node.type === "tag").first();
    if (root.length === 0) {
        throw new Error("XML dataset has no root element.");
    }

    const limitations = new Set<string>();
    const tables: NormalizedDatasetTable[] = [];
    const rootChildren = root.children().filter((_, node) => node.type === "tag");
    const grouped = new Map<string, any[]>();

    rootChildren.each((_, child) => {
        const bucket = grouped.get(child.tagName) ?? [];
        bucket.push(child);
        grouped.set(child.tagName, bucket);
    });

    for (const [tagName, elements] of grouped.entries()) {
        if (elements.length < 2) continue;
        const rows = elements.map((element) => {
            const flattened = collectXmlRecord($(element), $, limitations, { parentKey: "", depth: 0, maxDepth: 3 });
            const normalized: DatasetRow = {};
            for (const [key, value] of Object.entries(flattened)) {
                normalized[key] = toDatasetPrimitive(value);
            }
            return normalized;
        });
        const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 60);
        const normalizedRows = rows.map((row) => {
            const normalized: DatasetRow = {};
            for (const header of headers) {
                normalized[header] = row[header] ?? null;
            }
            return normalized;
        });
        tables.push({
            name: tagName,
            sourceFormat: "xml",
            rows: normalizedRows,
            profile: buildTableProfile(tagName, "xml", headers, normalizedRows, headers.length >= 60 ? ["Column list truncated to the first 60 detected XML fields."] : undefined),
        });
    }

    if (tables.length === 0) {
        const flattened = collectXmlRecord(root, $, limitations, {
            parentKey: root.get(0)?.tagName ?? "root",
            depth: 0,
            maxDepth: 3,
        });
        const headers = Array.from(new Set(Object.keys(flattened))).slice(0, 60);
        const row: DatasetRow = {};
        for (const header of headers) {
            row[header] = toDatasetPrimitive(flattened[header]);
        }
        tables.push({
            name: root.get(0)?.tagName ?? "root",
            sourceFormat: "xml",
            rows: [row],
            profile: buildTableProfile(root.get(0)?.tagName ?? "root", "xml", headers, [row], ["XML did not expose repeated sibling records; wrapped as a single-row flattened structure."]),
        });
    } else {
        limitations.add("XML support is optimized for repeated sibling record structures. Deeply hierarchical XML may require a custom mapper.");
    }

    return {
        sourceFormat: "xml",
        tables,
        facts: aggregateFacts(tables.map((table) => table.profile)),
        limitations: [...limitations],
    };
}

function parseSqlToken(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed || /^null$/i.test(trimmed)) return null;
    if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : trimmed;
    }
    return trimmed;
}

function splitSqlTuple(tupleContent: string): unknown[] {
    const values: unknown[] = [];
    let current = "";
    let inString = false;

    for (let index = 0; index < tupleContent.length; index += 1) {
        const char = tupleContent[index]!;
        const next = tupleContent[index + 1];

        if (char === "'" && inString && next === "'") {
            current += "'";
            index += 1;
            continue;
        }

        if (char === "'") {
            inString = !inString;
            continue;
        }

        if (char === "," && !inString) {
            values.push(parseSqlToken(current));
            current = "";
            continue;
        }

        current += char;
    }

    if (current.length > 0 || tupleContent.endsWith(",")) {
        values.push(parseSqlToken(current));
    }

    return values;
}

function splitSqlTuples(valuesBlock: string): string[] {
    const tuples: string[] = [];
    let depth = 0;
    let inString = false;
    let current = "";

    for (let index = 0; index < valuesBlock.length; index += 1) {
        const char = valuesBlock[index]!;
        const next = valuesBlock[index + 1];

        if (char === "'" && inString && next === "'") {
            current += "''";
            index += 1;
            continue;
        }

        if (char === "'") {
            inString = !inString;
            current += char;
            continue;
        }

        if (!inString && char === "(") {
            depth += 1;
            if (depth === 1) {
                current = "";
                continue;
            }
        }

        if (!inString && char === ")") {
            depth -= 1;
            if (depth === 0) {
                tuples.push(current);
                current = "";
                continue;
            }
        }

        if (depth >= 1) {
            current += char;
        }
    }

    return tuples;
}

function readSqlTables(buffer: Buffer): NormalizedDataset {
    const raw = buffer.toString("utf8");
    const insertRegex = /insert\s+into\s+[`"]?([\w.-]+)[`"]?\s*\(([^)]+)\)\s*values\s*([\s\S]*?);/gi;
    const tableRows = new Map<string, DatasetRow[]>();
    const limitations = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = insertRegex.exec(raw)) !== null) {
        const tableName = match[1]!;
        const columnBlock = match[2]!;
        const valuesBlock = match[3]!;
        const columns = columnBlock.split(",").map((column) => column.trim().replace(/[`"]/g, ""));
        const tuples = splitSqlTuples(valuesBlock);
        const rows = tableRows.get(tableName) ?? [];

        for (const tuple of tuples) {
            const values = splitSqlTuple(tuple);
            if (values.length !== columns.length) {
                limitations.add(`A SQL INSERT row for table "${tableName}" was skipped because value count did not match column count.`);
                continue;
            }
            const row: DatasetRow = {};
            for (let index = 0; index < columns.length; index += 1) {
                row[columns[index]!] = toDatasetPrimitive(values[index], inferValueType([values[index]]));
            }
            rows.push(row);
        }

        tableRows.set(tableName, rows);
    }

    if (tableRows.size === 0) {
        throw new Error("SQL dataset must contain INSERT INTO ... (columns) VALUES (...) statements.");
    }

    limitations.add("SQL support is limited to INSERT INTO ... (columns) VALUES (...) dumps. Schema-only or procedural SQL is not interpreted as grounded table data.");
    const tables: NormalizedDatasetTable[] = [...tableRows.entries()].map(([tableName, rows]) => {
        const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 60);
        const normalizedRows = rows.map((row) => {
            const normalized: DatasetRow = {};
            for (const header of headers) {
                normalized[header] = row[header] ?? null;
            }
            return normalized;
        });
        return {
            name: tableName,
            sourceFormat: "sql",
            rows: normalizedRows,
            profile: buildTableProfile(tableName, "sql", headers, normalizedRows, headers.length >= 60 ? ["Column list truncated to the first 60 detected SQL fields."] : undefined),
        };
    });

    return {
        sourceFormat: "sql",
        tables,
        facts: aggregateFacts(tables.map((table) => table.profile)),
        limitations: [...limitations],
    };
}

export async function normalizeDatasetBuffer(
    buffer: Buffer,
    mimeType: string,
): Promise<NormalizedDataset | null> {
    const mime = mimeType.toLowerCase().split(";")[0]!.trim();

    if (mime === "text/csv" || mime === "application/csv") {
        return readWorkbookTables(buffer, "csv");
    }

    if (
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        mime === "application/vnd.ms-excel"
    ) {
        return readWorkbookTables(buffer, "xlsx");
    }

    if (mime === "application/json") {
        return readJsonTables(buffer);
    }

    if (mime === "application/xml" || mime === "text/xml") {
        return readXmlTables(buffer);
    }

    if (mime === "application/sql" || mime === "text/sql" || mime === "text/x-sql") {
        return readSqlTables(buffer);
    }

    return null;
}
