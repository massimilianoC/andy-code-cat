/**
 * The one wiring of the project data registry (docs/specs/PROJECT_DATA_PANEL.md).
 *
 * Every capability that stores records for a project is listed here exactly once. The owner's
 * data panel and project deletion both build the registry from this function, so a capability
 * added here is browsable, exportable, clearable and purged with its project — and one that is
 * missing here is missing from all of them, visibly, rather than from deletion only.
 */
import { LeaderboardProjectData } from "../application/projectData/LeaderboardProjectData";
import { ProjectDataRegistry } from "../application/projectData/ProjectDataRegistry";
import type { ProjectDataCapability } from "../domain/projectData/ProjectDataCapability";
import { MongoLeaderboardRepository } from "../infra/repositories/MongoLeaderboardRepository";

export function composeProjectDataCapabilities(): ProjectDataCapability[] {
    return [
        new LeaderboardProjectData(new MongoLeaderboardRepository()),
    ];
}

export function composeProjectDataRegistry(): ProjectDataRegistry {
    return new ProjectDataRegistry(composeProjectDataCapabilities());
}
