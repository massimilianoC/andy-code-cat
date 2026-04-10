import { call } from "./call";

export interface StyleTagDef {
    id: string;
    category: string;
    label: string;
    emoji?: string;
    description?: string;
}

export interface StyleTagCatalog {
    [category: string]: StyleTagDef[];
}

export function getStyleTags() {
    return call<{ catalog: StyleTagCatalog }>("GET", "/v1/style-tags");
}

export interface UserStyleProfileDto {
    id: string;
    userId: string;
    onboardingCompleted: boolean;
    onboardingStep: number;
    identityTags: string[];
    sectorTags: string[];
    audienceTags: string[];
    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    referenceTags: string[];
    featureTags: string[];
    brandBio?: string;
    preferredColorText?: string;
    createdAt: string;
    updatedAt: string;
}

export function getUserStyleProfile(token: string) {
    return call<{ profile: UserStyleProfileDto }>("GET", "/v1/users/me/profile", undefined, {
        Authorization: `Bearer ${token}`,
    });
}

export function updateUserStyleProfile(
    token: string,
    data: Partial<Omit<UserStyleProfileDto, "id" | "userId" | "createdAt" | "updatedAt">>
) {
    return call<{ profile: UserStyleProfileDto }>("PUT", "/v1/users/me/profile", data, {
        Authorization: `Bearer ${token}`,
    });
}

export interface ProjectMoodboardDto {
    id: string;
    projectId: string;
    userId: string;
    inheritFromUser: boolean;
    visualTags: string[];
    paletteTags: string[];
    typographyTags: string[];
    layoutTags: string[];
    toneTags: string[];
    audienceTags: string[];
    featureTags: string[];
    referenceTags: string[];
    eraTags: string[];
    projectBrief?: string;
    targetBusiness?: string;
    styleNotes?: string;
    createdAt: string;
    updatedAt: string;
}

export function getProjectMoodboard(token: string, projectId: string) {
    return call<{ moodboard: ProjectMoodboardDto }>(
        "GET",
        `/v1/projects/${projectId}/moodboard`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}

export function updateProjectMoodboard(
    token: string,
    projectId: string,
    data: Partial<Omit<ProjectMoodboardDto, "id" | "projectId" | "userId" | "createdAt" | "updatedAt">>
) {
    return call<{ moodboard: ProjectMoodboardDto }>(
        "PUT",
        `/v1/projects/${projectId}/moodboard`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId }
    );
}
