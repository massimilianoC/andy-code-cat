import { type Collection } from "mongodb";
import type { ProjectPreset } from "../../domain/entities/ProjectPreset";
import type { ProjectPresetRepository, ProjectPresetUpsertInput } from "../../domain/repositories/ProjectPresetRepository";
import { getDb } from "../db/mongo";

interface ProjectPresetDocument extends Omit<ProjectPreset, "outputSpec"> {
    outputSpec: ProjectPreset["outputSpec"];
    createdAt: Date;
    updatedAt: Date;
}

function normalizePreset(input: ProjectPresetUpsertInput, existing?: ProjectPresetDocument | null): ProjectPresetDocument {
    const now = new Date();
    return {
        id: input.id,
        label: input.label ?? existing?.label ?? input.id,
        labelIt: input.labelIt ?? existing?.labelIt ?? input.label ?? existing?.label ?? input.id,
        labelEn: input.labelEn ?? existing?.labelEn ?? input.label ?? existing?.label ?? input.id,
        hint: input.hint ?? existing?.hint ?? "",
        icon: input.icon ?? existing?.icon ?? "Sparkles",
        category: input.category ?? existing?.category ?? "custom",
        categoryLabel: input.categoryLabel ?? existing?.categoryLabel ?? "Custom",
        categoryHint: input.categoryHint ?? existing?.categoryHint ?? "",
        tags: input.tags ?? existing?.tags ?? [],
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? 999,
        isActive: input.isActive ?? existing?.isActive ?? true,
        scope: input.scope ?? existing?.scope ?? "global",
        status: input.status ?? existing?.status ?? "published",
        ownerUserId: input.ownerUserId ?? existing?.ownerUserId,
        recommendedModel: input.recommendedModel ?? existing?.recommendedModel,
        outputSpec: {
            pageModel: input.outputSpec?.pageModel ?? existing?.outputSpec?.pageModel ?? "single_page",
            sectionModel: input.outputSpec?.sectionModel ?? existing?.outputSpec?.sectionModel ?? "scroll",
            recommendedPageCount: input.outputSpec?.recommendedPageCount ?? existing?.outputSpec?.recommendedPageCount,
            aspectRatio: input.outputSpec?.aspectRatio ?? existing?.outputSpec?.aspectRatio,
            cssConstraints: input.outputSpec?.cssConstraints ?? existing?.outputSpec?.cssConstraints,
            printReady: input.outputSpec?.printReady ?? existing?.outputSpec?.printReady ?? false,
            systemPromptModule: input.outputSpec?.systemPromptModule ?? existing?.outputSpec?.systemPromptModule ?? "",
        },
        defaultTags: {
            visualTags: input.defaultTags?.visualTags ?? existing?.defaultTags?.visualTags ?? [],
            paletteTags: input.defaultTags?.paletteTags ?? existing?.defaultTags?.paletteTags ?? [],
            typographyTags: input.defaultTags?.typographyTags ?? existing?.defaultTags?.typographyTags ?? [],
            layoutTags: input.defaultTags?.layoutTags ?? existing?.defaultTags?.layoutTags ?? [],
            toneTags: input.defaultTags?.toneTags ?? existing?.defaultTags?.toneTags ?? [],
            featureTags: input.defaultTags?.featureTags ?? existing?.defaultTags?.featureTags ?? [],
            audienceTags: input.defaultTags?.audienceTags ?? existing?.defaultTags?.audienceTags ?? [],
            sectorTags: input.defaultTags?.sectorTags ?? existing?.defaultTags?.sectorTags ?? [],
        },
        briefTemplate: input.briefTemplate ?? existing?.briefTemplate ?? "",
        styleTemplate: input.styleTemplate ?? existing?.styleTemplate ?? "",
        briefGuideQuestions: input.briefGuideQuestions ?? existing?.briefGuideQuestions ?? [],
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
}

function mapDocument(doc: ProjectPresetDocument): ProjectPreset {
    return {
        id: doc.id,
        label: doc.label,
        labelIt: doc.labelIt,
        labelEn: doc.labelEn,
        hint: doc.hint,
        icon: doc.icon,
        category: doc.category,
        categoryLabel: doc.categoryLabel,
        categoryHint: doc.categoryHint,
        tags: doc.tags,
        sortOrder: doc.sortOrder,
        isActive: doc.isActive,
        scope: doc.scope,
        status: doc.status,
        ownerUserId: doc.ownerUserId,
        recommendedModel: doc.recommendedModel,
        outputSpec: doc.outputSpec,
        defaultTags: doc.defaultTags,
        briefTemplate: doc.briefTemplate,
        styleTemplate: doc.styleTemplate,
        briefGuideQuestions: doc.briefGuideQuestions,
    };
}

export class MongoProjectPresetRepository implements ProjectPresetRepository {
    private async collection(): Promise<Collection<ProjectPresetDocument>> {
        const db = await getDb();
        const collection = db.collection<ProjectPresetDocument>("project_presets");
        await collection.createIndex({ id: 1 }, { unique: true });
        await collection.createIndex({ isActive: 1, scope: 1, status: 1, sortOrder: 1 });
        await collection.createIndex({ category: 1, sortOrder: 1 });
        return collection;
    }

    async listActive(): Promise<ProjectPreset[]> {
        const collection = await this.collection();
        const docs = await collection
            .find({ isActive: true, scope: "global", status: { $in: ["published", "pending_review"] } })
            .sort({ sortOrder: 1, labelIt: 1 })
            .toArray();
        return docs.map(mapDocument);
    }

    async listAll(): Promise<ProjectPreset[]> {
        const collection = await this.collection();
        const docs = await collection
            .find({})
            .sort({ sortOrder: 1, category: 1, labelIt: 1 })
            .toArray();
        return docs.map(mapDocument);
    }

    async findById(id: string): Promise<ProjectPreset | null> {
        const collection = await this.collection();
        const doc = await collection.findOne({ id });
        return doc ? mapDocument(doc) : null;
    }

    async upsert(preset: ProjectPresetUpsertInput): Promise<ProjectPreset> {
        const collection = await this.collection();
        const existing = await collection.findOne({ id: preset.id });
        const normalized = normalizePreset(preset, existing);
        const { createdAt, ...mutableFields } = normalized;

        await collection.updateOne(
            { id: normalized.id },
            {
                $set: mutableFields,
                $setOnInsert: { createdAt },
            },
            { upsert: true },
        );

        const saved = await collection.findOne({ id: normalized.id });
        if (!saved) throw new Error("Failed to persist project preset");
        return mapDocument(saved);
    }

    async delete(id: string): Promise<boolean> {
        const collection = await this.collection();
        const result = await collection.deleteOne({ id });
        return result.deletedCount === 1;
    }

    async seedDefaults(presets: ProjectPreset[]): Promise<{ upserted: number }> {
        let upserted = 0;
        for (const preset of presets) {
            await this.upsert(preset);
            upserted += 1;
        }
        return { upserted };
    }
}
