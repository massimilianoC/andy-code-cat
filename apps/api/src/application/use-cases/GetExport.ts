import type { ExportRecord } from "../../domain/entities/ExportRecord";
import type { ExportRepository } from "../../domain/repositories/ExportRepository";

export class GetExport {
    constructor(private readonly exportRepository: ExportRepository) { }

    async execute(exportId: string): Promise<ExportRecord> {
        const record = await this.exportRepository.findById(exportId);
        if (!record) {
            throw Object.assign(new Error("Export not found"), { statusCode: 404 });
        }
        return record;
    }
}
