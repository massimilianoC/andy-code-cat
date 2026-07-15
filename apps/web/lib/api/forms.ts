import type { ProjectFormSettingsInput } from "@andy-code-cat/contracts";
import { call } from "./call";

export function getProjectFormSettings(token: string, projectId: string) {
    return call<{ settings: ProjectFormSettingsInput | null }>(
        "GET",
        `/v1/projects/${projectId}/services/forms`,
        undefined,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}

export function updateProjectFormSettings(
    token: string,
    projectId: string,
    settings: ProjectFormSettingsInput,
) {
    return call<{ settings: ProjectFormSettingsInput }>(
        "PUT",
        `/v1/projects/${projectId}/services/forms`,
        settings,
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        },
    );
}
