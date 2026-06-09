import type {
    DatasetAskResponseDto,
    DatasetBrowseInput,
    DatasetBrowseResponseDto,
    DatasetDashboardSuggestionResponseDto,
    DatasetInsightsResponseDto,
    DatasetProfileDto,
    DatasetQueryInput,
    DatasetQueryResponseDto,
    ProjectDatasetListItemDto,
    ProjectDatasetListResponseDto,
} from "@andy-code-cat/contracts";
export type {
    DatasetAskResponseDto,
    DatasetBrowseInput,
    DatasetBrowseResponseDto,
    DatasetDashboardSuggestionResponseDto,
    DatasetInsightsResponseDto,
    DatasetProfileDto,
    DatasetQueryInput,
    DatasetQueryResponseDto,
    ProjectDatasetListItemDto,
    ProjectDatasetListResponseDto,
} from "@andy-code-cat/contracts";
import { call } from "./call";

export type DatasetListItem = ProjectDatasetListItemDto;

function withTableName(path: string, tableName?: string): string {
    if (!tableName) return path;
    const params = new URLSearchParams({ tableName });
    return `${path}?${params.toString()}`;
}

export function listProjectDatasets(token: string, projectId: string) {
    return call<ProjectDatasetListResponseDto>(
        "GET",
        `/v1/projects/${projectId}/datasets`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function getDatasetProfile(token: string, projectId: string, assetId: string) {
    return call<DatasetProfileDto>(
        "GET",
        `/v1/projects/${projectId}/datasets/${assetId}/profile`,
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function getDatasetInsights(token: string, projectId: string, assetId: string, tableName?: string) {
    return call<DatasetInsightsResponseDto>(
        "GET",
        withTableName(`/v1/projects/${projectId}/datasets/${assetId}/insights`, tableName),
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function getDatasetDashboardSuggestion(token: string, projectId: string, assetId: string, tableName?: string) {
    return call<DatasetDashboardSuggestionResponseDto>(
        "GET",
        withTableName(`/v1/projects/${projectId}/datasets/${assetId}/dashboard-suggestion`, tableName),
        undefined,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function queryDataset(token: string, projectId: string, assetId: string, data: DatasetQueryInput) {
    return call<DatasetQueryResponseDto>(
        "POST",
        `/v1/projects/${projectId}/datasets/${assetId}/query`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function askDataset(token: string, projectId: string, assetId: string, question: string, tableName?: string) {
    return call<DatasetAskResponseDto>(
        "POST",
        `/v1/projects/${projectId}/datasets/${assetId}/ask`,
        { question, tableName },
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}

export function browseDataset(token: string, projectId: string, assetId: string, data: DatasetBrowseInput) {
    return call<DatasetBrowseResponseDto>(
        "POST",
        `/v1/projects/${projectId}/datasets/${assetId}/browse`,
        data,
        { Authorization: `Bearer ${token}`, "x-project-id": projectId },
    );
}
