import { call } from "./call";

export interface Project {
    id: string;
    name: string;
    ownerUserId: string;
    presetId?: string;
    createdAt: string;
}

export interface PresetOutputSpec {
    pageModel: 'single_page' | 'multi_page' | 'slide_deck' | 'print_a4';
    sectionModel: 'scroll' | 'paginated' | 'masonry' | 'stepped_form';
    recommendedPageCount?: number;
    aspectRatio?: '16:9' | '4:3' | 'A4_portrait' | 'A4_landscape' | 'free';
    cssConstraints?: string;
    printReady: boolean;
    systemPromptModule: string;
}

export interface PresetTagDefaults {
    visualTags?: string[];
    paletteTags?: string[];
    typographyTags?: string[];
    layoutTags?: string[];
    toneTags?: string[];
    featureTags?: string[];
    audienceTags?: string[];
}

export interface ProjectPreset {
    id: string;
    label: string;
    labelIt: string;
    labelEn: string;
    hint: string;
    icon: string;
    outputSpec: PresetOutputSpec;
    defaultTags: PresetTagDefaults;
    briefTemplate: string;
    styleTemplate: string;
    briefGuideQuestions: string[];
}

export function getPresets() {
    return call<{ presets: ProjectPreset[] }>("GET", "/v1/presets");
}

export function listProjects(token: string) {
    return call<{ projects: Project[] }>("GET", "/v1/projects", undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export function createProject(token: string, name: string, presetId?: string) {
    return call<{ project: Project }>("POST", "/v1/projects", { name, ...(presetId ? { presetId } : {}) }, {
        Authorization: `Bearer ${token}`,
    });
}

export function createSession(token: string, projectId: string) {
    return call<{ message: string; projectId: string }>(
        "POST",
        `/v1/projects/${projectId}/sessions`,
        {},
        {
            Authorization: `Bearer ${token}`,
            "x-project-id": projectId,
        }
    );
}

export function getProject(token: string, projectId: string) {
    return call<{ project: Project }>(
        "GET",
        `/v1/projects/${projectId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function renameProject(token: string, projectId: string, name: string) {
    return call<{ project: Project }>(
        "PATCH",
        `/v1/projects/${projectId}`,
        { name },
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function deleteProject(token: string, projectId: string) {
    return call<void>(
        "DELETE",
        `/v1/projects/${projectId}`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function duplicateProject(token: string, projectId: string, name?: string) {
    return call<{ project: Project }>(
        "POST",
        `/v1/projects/${projectId}/duplicate`,
        name ? { name } : {},
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
