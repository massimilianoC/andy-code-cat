export interface Project {
    id: string;
    ownerUserId: string;
    name: string;
    /** Optional preset ID from the PRESET_CATALOG. Undefined for fast-created projects. */
    presetId?: string;
    createdAt: Date;
}
