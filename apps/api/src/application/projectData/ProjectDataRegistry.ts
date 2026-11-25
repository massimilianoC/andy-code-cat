import type { ProjectDataCapability, ProjectDataScope } from "../../domain/projectData/ProjectDataCapability";

/**
 * The list of capabilities that store project records. Add a capability here once and it is
 * summarised, browsable, exportable, clearable — and purged with its project.
 */
export class ProjectDataRegistry {
    private readonly byId: Map<string, ProjectDataCapability>;

    constructor(readonly capabilities: readonly ProjectDataCapability[]) {
        this.byId = new Map(capabilities.map((capability) => [capability.id, capability]));
        if (this.byId.size !== capabilities.length) throw new Error("Duplicate project data capability id");
    }

    get(id: string): ProjectDataCapability | undefined {
        return this.byId.get(id);
    }

    /** Every record of every capability for the project. Used by project deletion. */
    async purgeProject(scope: ProjectDataScope): Promise<Record<string, number>> {
        const removed = await Promise.all(this.capabilities.map(async (capability) => [capability.id, await capability.clear(scope)] as const));
        return Object.fromEntries(removed);
    }
}
