import { describe, expect, it } from "vitest";
import type { ProjectAsset } from "../../../domain/entities/ProjectAsset";
import type { IFileStorage } from "../../../infra/storage/IFileStorage";
import { normalizeDatasetBuffer } from "../DatasetRuntime";
import { answerDatasetQuestion, browseDatasetRows, buildDatasetInsights, executeDatasetQuery } from "../DatasetQueryEngine";
import { DatasetCacheStore } from "../DatasetCacheStore";

describe("DatasetRuntime", () => {
    it("normalizes CSV and computes deterministic numeric profiles", async () => {
        const csv = [
            "plant,shift,output_kwh",
            "A,morning,120.5",
            "A,night,132.0",
            "B,morning,98.5",
        ].join("\n");

        const dataset = await normalizeDatasetBuffer(Buffer.from(csv, "utf8"), "text/csv");
        expect(dataset).not.toBeNull();
        expect(dataset!.facts.rowCount).toBe(3);
        expect(dataset!.tables[0]!.profile.columns.find((column) => column.key === "output_kwh")?.valueType).toBe("number");
        expect(dataset!.tables[0]!.profile.columns.find((column) => column.key === "output_kwh")?.sum).toBe(351);
    });

    it("normalizes JSON array-of-records and exposes queryable tables", async () => {
        const json = JSON.stringify([
            { machine: "M1", status: "ok", units: 10 },
            { machine: "M2", status: "ok", units: 15 },
            { machine: "M1", status: "stop", units: 5 },
        ]);

        const dataset = await normalizeDatasetBuffer(Buffer.from(json, "utf8"), "application/json");
        expect(dataset).not.toBeNull();
        expect(dataset!.tables[0]!.name).toBe("root");

        const grouped = executeDatasetQuery(dataset!, {
            tableName: "root",
            aggregation: "sum",
            column: "units",
            groupBy: "machine",
        });

        expect(grouped.result).toEqual([
            { key: "M1", value: 15 },
            { key: "M2", value: 15 },
        ]);

        const browse = browseDatasetRows(dataset!, {
            tableName: "root",
            offset: 1,
            limit: 1,
        });
        expect(browse.rows).toHaveLength(1);
        expect(browse.rows[0]?.machine).toBe("M2");

        const sortedBrowse = browseDatasetRows(dataset!, {
            tableName: "root",
            offset: 0,
            limit: 2,
            sort: { column: "units", direction: "desc" },
        });
        expect(sortedBrowse.rows[0]?.units).toBe(15);
    });

    it("answers supported questions and refuses unsupported ones", async () => {
        const csv = [
            "department,cost_eur",
            "energy,100",
            "maintenance,50",
            "energy,70",
        ].join("\n");

        const dataset = await normalizeDatasetBuffer(Buffer.from(csv, "utf8"), "text/csv");
        expect(dataset).not.toBeNull();

        const supported = answerDatasetQuestion(dataset!, "What is the total cost_eur?", "Sheet1");
        expect(supported.supported).toBe(true);
        expect(supported.query?.result).toBe(220);

        const unsupported = answerDatasetQuestion(dataset!, "Why did costs increase unexpectedly?", "Sheet1");
        expect(unsupported.supported).toBe(false);
        expect(unsupported.refusalReason).toContain("supported deterministic query");
    });

    it("flattens nested JSON objects into deterministic dotted columns", async () => {
        const json = JSON.stringify([
            {
                machine: "M1",
                telemetry: {
                    output: { kwh: 12.5, unit: "kwh" },
                    status: "ok",
                },
                alarms: ["A1", "A2"],
            },
        ]);

        const dataset = await normalizeDatasetBuffer(Buffer.from(json, "utf8"), "application/json");
        expect(dataset).not.toBeNull();
        expect(dataset!.tables[0]!.profile.columns.some((column) => column.key === "telemetry.output.kwh")).toBe(true);
        expect(dataset!.tables[0]!.rows[0]!["telemetry.output.kwh"]).toBe(12.5);
        expect(dataset!.tables[0]!.rows[0]!.alarms).toBe(2);
        expect(dataset!.limitations.some((entry) => entry.includes("Nested arrays"))).toBe(true);
    });

    it("normalizes repeated XML sibling nodes as a grounded table", async () => {
        const xml = [
            "<plants>",
            '  <plant id="A1"><name>Line A</name><output><kwh>120.5</kwh></output><status>ok</status></plant>',
            '  <plant id="B1"><name>Line B</name><output><kwh>98.2</kwh></output><status>stop</status></plant>',
            "</plants>",
        ].join("");

        const dataset = await normalizeDatasetBuffer(Buffer.from(xml, "utf8"), "application/xml");
        expect(dataset).not.toBeNull();
        expect(dataset!.sourceFormat).toBe("xml");
        expect(dataset!.tables[0]!.name).toBe("plant");
        expect(dataset!.tables[0]!.profile.rowCount).toBe(2);
        expect(dataset!.tables[0]!.profile.columns.some((column) => column.key === "@id")).toBe(true);
        expect(dataset!.tables[0]!.profile.columns.some((column) => column.key === "output.kwh")).toBe(true);
    });

    it("normalizes SQL INSERT dumps into grounded tables", async () => {
        const sql = [
            "INSERT INTO plants (plant_id, shift, output_kwh) VALUES",
            "(1, 'morning', 120.5),",
            "(2, 'night', 98.2);",
            "INSERT INTO alarms (alarm_id, severity) VALUES",
            "(10, 'high'),",
            "(11, 'low');",
        ].join("\n");

        const dataset = await normalizeDatasetBuffer(Buffer.from(sql, "utf8"), "application/sql");
        expect(dataset).not.toBeNull();
        expect(dataset!.sourceFormat).toBe("sql");
        expect(dataset!.tables.find((table) => table.name === "plants")?.profile.rowCount).toBe(2);
        expect(dataset!.tables.find((table) => table.name === "plants")?.rows[0]?.output_kwh).toBe(120.5);
        expect(dataset!.tables.find((table) => table.name === "alarms")?.rows[1]?.severity).toBe("low");
        expect(dataset!.limitations.some((entry) => entry.includes("INSERT INTO"))).toBe(true);
    });

    it("rejects SQL dumps without supported INSERT statements", async () => {
        const sql = "CREATE TABLE plants (plant_id INT, output_kwh FLOAT);";
        await expect(normalizeDatasetBuffer(Buffer.from(sql, "utf8"), "text/sql")).rejects.toThrow(
            "SQL dataset must contain INSERT INTO",
        );
    });

    it("wraps non-tabular XML as a single flattened row with an explicit limitation", async () => {
        const xml = [
            "<machine>",
            "  <name>Press 01</name>",
            "  <telemetry><temperature>72</temperature><pressure>3.4</pressure></telemetry>",
            "</machine>",
        ].join("");

        const dataset = await normalizeDatasetBuffer(Buffer.from(xml, "utf8"), "text/xml");
        expect(dataset).not.toBeNull();
        expect(dataset!.tables[0]!.profile.rowCount).toBe(1);
        expect(dataset!.tables[0]!.rows[0]!["machine.telemetry.temperature"]).toBe("72");
        expect(dataset!.tables[0]!.profile.notes?.[0]).toContain("single-row flattened structure");
    });

    it("builds insights for the selected table instead of always using the first one", async () => {
        const json = JSON.stringify({
            plants: [{ plant: "A", units: 10 }],
            machines: [{ machine: "M1", status: "ok" }, { machine: "M2", status: "stop" }],
        });

        const dataset = await normalizeDatasetBuffer(Buffer.from(json, "utf8"), "application/json");
        expect(dataset).not.toBeNull();

        const insights = buildDatasetInsights(dataset!, "machines");
        expect(insights.insights[0]?.facts.find((fact) => fact.label === "table")?.value).toBe("machines");
        expect(insights.insights[0]?.facts.find((fact) => fact.label === "rows")?.value).toBe(2);
    });

    it("persists and reuses normalized dataset cache with asset fingerprint validation", async () => {
        const profileData = new Map<string, Buffer>();
        const storage: IFileStorage = {
            uploadDirPath: () => "",
            uploadFilePath: () => "",
            saveUpload: async () => "",
            deleteUpload: async () => undefined,
            createReadStream: async () => { throw new Error("not used"); },
            exportDirPath: () => "",
            exportZipPath: () => "",
            writeExportFile: async () => undefined,
            deleteExportDir: async () => undefined,
            publishDirPath: () => "",
            writePublishFiles: async () => [],
            resolvePublishFile: () => null,
            deletePublishDir: async () => undefined,
            copyPublishDir: async () => undefined,
            workspacePath: () => "",
            workspaceInputPath: () => "",
            workspaceInputAssetsPath: () => "",
            workspaceInputLayer1Path: () => "",
            workspaceOutputPath: () => "",
            workspaceLogsPath: () => "",
            writeWorkspaceFile: async () => "",
            deleteWorkspaceDir: async () => undefined,
            profileDirPath: () => "",
            writeProfileData: async (_userId, filename, data) => {
                profileData.set(filename, Buffer.isBuffer(data) ? data : Buffer.from(data));
            },
            readProfileData: async (_userId, filename) => profileData.get(filename) ?? null,
            deleteProfileData: async (_userId, filename) => {
                profileData.delete(filename);
            },
            thumbnailFilePath: () => "",
            saveThumbnailFile: async () => "",
            getThumbnailStream: async () => { throw new Error("not used"); },
            deleteThumbnailFile: async () => undefined,
            ensureDir: async () => undefined,
            fileExists: async () => false,
            fileSize: async () => 0,
        };

        const dataset = await normalizeDatasetBuffer(Buffer.from('[{"machine":"M1","units":10}]', "utf8"), "application/json");
        expect(dataset).not.toBeNull();

        const cache = new DatasetCacheStore(storage);
        const asset: ProjectAsset = {
            id: "asset-1",
            projectId: "project-1",
            userId: "user-1",
            scope: "project",
            originalName: "dataset.json",
            storedFilename: "asset-1-dataset.json",
            mimeType: "application/json",
            fileSize: 128,
            source: "user_upload",
            createdAt: new Date(),
        };

        await cache.write(asset, dataset!);
        expect(await cache.exists(asset)).toBe(true);
        const restored = await cache.read(asset);
        expect(restored?.tables[0]?.rows[0]?.units).toBe(10);

        const stale = await cache.read({
            ...asset,
            fileSize: 256,
        });
        expect(stale).toBeNull();
        expect(await cache.exists({ ...asset, fileSize: 256 })).toBe(false);
    });
});
