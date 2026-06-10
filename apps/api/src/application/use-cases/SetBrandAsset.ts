import type { BrandAssetRepository } from "../../domain/repositories/BrandAssetRepository";
import type { BrandAsset, BrandAssetScope, BrandAssetRole, BrandAssetPolicy, BrandAssetValueType } from "../../domain/entities/BrandAsset";
import type { ProjectAssetRepository } from "../../domain/repositories/ProjectAssetRepository";

export interface SetBrandAssetTextInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    valueType: Extract<BrandAssetValueType, "text" | "color_list" | "url">;
    textValue: string;
    description?: string;
    isActive?: boolean;
    priority?: number;
}

export interface SetBrandAssetFileInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    description?: string;
    isActive?: boolean;
    priority?: number;
    // File upload path
    storedFilename: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
}

export interface SetBrandAssetPromoteInput {
    scope: BrandAssetScope;
    ownerUserId?: string;
    projectId?: string;
    role: BrandAssetRole;
    customRoleLabel?: string;
    policy: BrandAssetPolicy;
    description?: string;
    isActive?: boolean;
    priority?: number;
    sourceAssetId: string;
    sourceProjectId: string;
    sourceUserId: string;
}

export class SetBrandAsset {
    constructor(
        private readonly brandAssetRepository: BrandAssetRepository,
        private readonly projectAssetRepository: ProjectAssetRepository,
    ) {}

    async createText(input: SetBrandAssetTextInput): Promise<BrandAsset> {
        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: input.valueType,
            textValue: input.textValue,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }

    async createFile(input: SetBrandAssetFileInput): Promise<BrandAsset> {
        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: "asset_ref",
            storedFilename: input.storedFilename,
            originalName: input.originalName,
            mimeType: input.mimeType,
            fileSize: input.fileSize,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }

    async promote(input: SetBrandAssetPromoteInput): Promise<BrandAsset> {
        const source = await this.projectAssetRepository.findById(
            input.sourceAssetId,
            input.sourceProjectId,
            input.sourceUserId,
        );
        if (!source) throw new Error(`Source asset ${input.sourceAssetId} not found`);
        if (!source.storedFilename) throw new Error("Source asset has no stored file");

        return this.brandAssetRepository.create({
            scope: input.scope,
            ownerUserId: input.ownerUserId,
            projectId: input.projectId,
            role: input.role,
            customRoleLabel: input.customRoleLabel,
            policy: input.policy,
            valueType: "asset_ref",
            storedFilename: source.storedFilename,
            originalName: source.originalName,
            mimeType: source.mimeType,
            fileSize: source.fileSize,
            promotedFromAssetId: source.id,
            description: input.description,
            isActive: input.isActive ?? true,
            priority: input.priority ?? 0,
        });
    }
}
