import { createHash } from "crypto";
import { serviceManifestSchema, type FormSubmissionErrorCode, type FormSubmissionIssue } from "@andy-code-cat/contracts";
import type { PreviewSnapshotRepository } from "../../domain/repositories/PreviewSnapshotRepository";
import type { ProjectRepository } from "../../domain/repositories/ProjectRepository";
import type { SiteDeploymentRepository } from "../../domain/repositories/SiteDeploymentRepository";
import type { UserRepository } from "../../domain/repositories/UserRepository";
import type { FormSubmissionRepository } from "../../domain/repositories/FormSubmissionRepository";
import type { FormSubmissionQuota } from "../../domain/entities/FormSubmission";
import { validateFormSubmission } from "./FormSubmissionValidator";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same shape as the published-site publishId (publishRoutes PUBLISH_ID_RE). */
const PUBLISH_ID_RE = /^[a-z0-9]{6,12}$/;
/** Same shape as a manifest form id (serviceManifest idSchema). */
const FORM_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The salt of the stored IP hash: FORM_IP_HASH_SALT when set, otherwise derived from the export
 * secret so an installation never stores an unsalted (and thus reversible) IP hash.
 */
export function resolveFormIpHashSalt(env: { FORM_IP_HASH_SALT?: string; EXPORT_JWT_SECRET: string }): string {
    const explicit = env.FORM_IP_HASH_SALT?.trim();
    if (explicit) return explicit;
    return createHash("sha256").update(`andy-code-cat:form-ip-hash:v1:${env.EXPORT_JWT_SECRET}`, "utf8").digest("hex");
}

export function hashSubmitterIp(salt: string, ip: string): string {
    return createHash("sha256").update(`${salt}${ip}`, "utf8").digest("hex");
}

export type SubmitPublishedFormResult =
    | { outcome: "stored"; submissionId: string }
    | { outcome: "refused"; status: number; code: FormSubmissionErrorCode; issues?: FormSubmissionIssue[] };

export interface SubmitPublishedFormInput {
    publishId: string;
    formId: string;
    fields: Record<string, unknown>;
    ip: string;
}

/**
 * Public capture submit (FORMS_CAPTURE.md). Everything that decides where a submission goes and
 * whether it is accepted is resolved here, server-side, from the live deployment:
 *
 *   publishId → live deployment → not admin-blocked → owner exists and is not blocked
 *             → project owned by that owner → form settings enabled in capture mode
 *             → the deployed snapshot's manifest declares formId → fields validate against it
 *             → the form and the project are under their quota.
 *
 * The request contributes the publishId and formId it is addressed to, and field values; nothing
 * else. A refusal carries a code and, for validation, issues without values.
 */
export class SubmitPublishedForm {
    constructor(private readonly deps: {
        deployments: Pick<SiteDeploymentRepository, "findByPublishId">;
        users: Pick<UserRepository, "findById">;
        projects: Pick<ProjectRepository, "findById">;
        snapshots: Pick<PreviewSnapshotRepository, "findById">;
        submissions: Pick<FormSubmissionRepository, "create" | "usage">;
        ipHashSalt: string;
        quota: FormSubmissionQuota;
        retentionDays: number;
        now?: () => Date;
    }) { }

    async execute(input: SubmitPublishedFormInput): Promise<SubmitPublishedFormResult> {
        const refuse = (status: number, code: FormSubmissionErrorCode, issues?: FormSubmissionIssue[]): SubmitPublishedFormResult =>
            ({ outcome: "refused", status, code, ...(issues ? { issues } : {}) });

        if (!PUBLISH_ID_RE.test(input.publishId)) return refuse(404, "FORM_SITE_NOT_FOUND");
        if (!FORM_ID_RE.test(input.formId) || input.formId.length > 48) return refuse(404, "FORM_NOT_FOUND");

        const deployment = await this.deps.deployments.findByPublishId(input.publishId);
        if (!deployment || deployment.status !== "live") return refuse(404, "FORM_SITE_NOT_FOUND");
        if (deployment.isAdminBlocked) return refuse(403, "FORM_SITE_SUSPENDED");

        // Fail closed when the owner cannot be read. Unlike page serving, a missing owner record
        // (deleted account) also refuses: there is no controller left to receive personal data.
        let owner;
        try {
            owner = await this.deps.users.findById(deployment.userId);
        } catch {
            return refuse(503, "FORM_TEMPORARILY_UNAVAILABLE");
        }
        if (!owner || owner.isBlocked) return refuse(403, "FORM_SITE_SUSPENDED");

        const project = await this.deps.projects.findById(deployment.projectId);
        if (!project || project.ownerUserId !== deployment.userId) return refuse(404, "FORM_SITE_NOT_FOUND");

        const settings = project.serviceConfig?.forms;
        if (!settings?.enabled || settings.mode !== "capture") return refuse(409, "FORM_CAPTURE_DISABLED");

        // The manifest of the DEPLOYED snapshot — not the project's active version — is what the
        // visitor's page was built from, so it is the only definition a submission is checked against.
        const snapshot = await this.deps.snapshots.findById(deployment.projectId, deployment.snapshotId);
        const manifest = snapshot?.serviceManifest ? serviceManifestSchema.safeParse(snapshot.serviceManifest) : null;
        const form = manifest?.success ? manifest.data.forms.find((candidate) => candidate.id === input.formId) : undefined;
        if (!form) return refuse(404, "FORM_NOT_FOUND");

        const validation = validateFormSubmission(form, input.fields);
        if (!validation.ok) return refuse(400, "FORM_SUBMISSION_INVALID", validation.issues);

        // Quota: a project's storage is bounded per form and per project, in records and bytes. A
        // submission past it is refused (and logged for the owner's operator), never stored.
        const scope = { ownerUserId: deployment.userId, projectId: deployment.projectId, formId: form.id };
        const usage = await this.deps.submissions.usage(scope);
        const { quota } = this.deps;
        if (usage.formRecords >= quota.maxPerForm || usage.projectRecords >= quota.maxPerProject || usage.projectBytes >= quota.maxBytesPerProject) {
            console.warn("[forms] submission refused: quota reached", { projectId: deployment.projectId, formId: form.id, ...usage });
            // 507: a full store is not the visitor's fault and retrying soon will not help.
            return refuse(507, "FORM_QUOTA_EXCEEDED");
        }

        const now = this.deps.now?.() ?? new Date();
        const stored = await this.deps.submissions.create(
            scope,
            {
                publishId: deployment.publishId,
                snapshotId: deployment.snapshotId,
                fields: validation.values,
                privacyNoticeVersion: settings.privacyNotice.version,
                ipHash: hashSubmitterIp(this.deps.ipHashSalt, input.ip),
            },
            new Date(now.getTime() + this.deps.retentionDays * DAY_MS),
        );
        return { outcome: "stored", submissionId: stored.id };
    }
}
