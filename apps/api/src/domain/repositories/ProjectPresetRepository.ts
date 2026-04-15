import type { PresetOutputSpec, PresetTagDefaults, ProjectPreset } from "../entities/ProjectPreset";

export type ProjectPresetUpsertInput = Omit<Partial<ProjectPreset>, "outputSpec" | "defaultTags"> & {
    id: string;
    outputSpec?: Partial<PresetOutputSpec>;
    defaultTags?: Partial<PresetTagDefaults>;
};

export interface ProjectPresetRepository {
    listActive(): Promise<ProjectPreset[]>;
    listAll(): Promise<ProjectPreset[]>;
    findById(id: string): Promise<ProjectPreset | null>;
    upsert(preset: ProjectPresetUpsertInput): Promise<ProjectPreset>;
    delete(id: string): Promise<boolean>;
    seedDefaults(presets: ProjectPreset[]): Promise<{ upserted: number }>;
}
