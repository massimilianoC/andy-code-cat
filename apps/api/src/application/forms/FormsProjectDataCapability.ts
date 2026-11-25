import type { FormSubmission } from "../../domain/entities/FormSubmission";
import type {
    ProjectDataCapability,
    ProjectDataGroupSummary,
    ProjectDataListQuery,
    ProjectDataRecord,
    ProjectDataScope,
} from "../../domain/projectData/ProjectDataCapability";
import type { FormSubmissionRepository } from "../../domain/repositories/FormSubmissionRepository";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import { MongoFormSubmissionRepository } from "../../infra/repositories/MongoFormSubmissionRepository";
import { MongoPreviewSnapshotRepository } from "../../infra/repositories/MongoPreviewSnapshotRepository";
import { MongoSiteDeploymentRepository } from "../../infra/repositories/MongoSiteDeploymentRepository";

export const FORMS_PROJECT_DATA_CAPABILITY_ID = "forms";

/**
 * What the owner sees of one submission. The IP hash is left out: it exists for abuse
 * investigation, not for the owner's inbox (FORMS_CAPTURE.md §Data stored).
 */
function toRecord(submission: FormSubmission): ProjectDataRecord {
    return {
        id: submission.id,
        groupId: submission.formId,
        createdAt: submission.createdAt,
        data: {
            fields: { ...submission.fields },
            privacyNoticeVersion: submission.privacyNoticeVersion,
            publishId: submission.publishId,
            snapshotId: submission.snapshotId,
        },
    };
}

/**
 * Form submissions as a project data capability: one group per form id. Every call passes the
 * owner + project scope it receives straight to the repository, which spreads it into every query.
 */
export class FormsProjectDataCapability implements ProjectDataCapability {
    readonly id = FORMS_PROJECT_DATA_CAPABILITY_ID;
    readonly label = "Form submissions";

    constructor(private readonly deps: {
        submissions: FormSubmissionRepository;
        deployments: Pick<SiteDeploymentRepository, "findActiveByProjectId">;
        snapshots: Pick<PreviewSnapshotRepository, "findById">;
    }) { }

    /**
     * Form titles from the live deployment's manifest, when there is one. Two point reads; a
     * failure only costs the labels (the group falls back to its form id), never the data.
     */
    private async formTitles(scope: ProjectDataScope): Promise<Map<string, string>> {
        try {
            const deployment = await this.deps.deployments.findActiveByProjectId(scope.projectId);
            if (!deployment || deployment.userId !== scope.ownerUserId) return new Map();
            const snapshot = await this.deps.snapshots.findById(scope.projectId, deployment.snapshotId);
            return new Map((snapshot?.serviceManifest?.forms ?? []).map((form) => [form.id, form.title]));
        } catch (error) {
            console.warn("[form-capture] form titles unavailable; using form ids", {
                projectId: scope.projectId,
                error: error instanceof Error ? error.name : "unknown",
            });
            return new Map();
        }
    }

    async groups(scope: ProjectDataScope): Promise<ProjectDataGroupSummary[]> {
        const [groups, titles] = await Promise.all([this.deps.submissions.groups(scope), this.formTitles(scope)]);
        return groups.map((group) => ({
            id: group.formId,
            label: titles.get(group.formId) ?? group.formId,
            records: group.records,
            lastWriteAt: group.lastWriteAt,
        }));
    }

    async list(scope: ProjectDataScope, query: ProjectDataListQuery): Promise<{ items: ProjectDataRecord[]; total: number }> {
        const page = await this.deps.submissions.list(scope, {
            formId: query.groupId,
            page: query.page,
            limit: query.limit,
            search: query.search,
        });
        return { items: page.items.map(toRecord), total: page.total };
    }

    async exportRecords(scope: ProjectDataScope, groupId: string | undefined, max: number): Promise<ProjectDataRecord[]> {
        return (await this.deps.submissions.listNewest(scope, groupId, max)).map(toRecord);
    }

    async deleteRecord(scope: ProjectDataScope, recordId: string): Promise<boolean> {
        return this.deps.submissions.deleteById(scope, recordId);
    }

    async clear(scope: ProjectDataScope, groupId?: string): Promise<number> {
        return this.deps.submissions.deleteMany(scope, groupId);
    }
}

/** The forms capability over the MongoDB repositories; dependencies can be replaced in tests. */
export function createFormsProjectDataCapability(
    deps: Partial<ConstructorParameters<typeof FormsProjectDataCapability>[0]> = {},
): FormsProjectDataCapability {
    return new FormsProjectDataCapability({
        submissions: deps.submissions ?? new MongoFormSubmissionRepository(),
        deployments: deps.deployments ?? new MongoSiteDeploymentRepository(),
        snapshots: deps.snapshots ?? new MongoPreviewSnapshotRepository(),
    });
}
