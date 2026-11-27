/**
 * A form submission captured on a published site (docs/specs/FORMS_CAPTURE.md).
 *
 * Scope: every stored document and every query carries the owner and the project; a single form
 * is addressed with the form id as well. The scope is always resolved by the server from the live
 * deployment — never taken from the request.
 */
export interface FormSubmissionProjectScope {
    ownerUserId: string;
    projectId: string;
}

export interface FormSubmissionScope extends FormSubmissionProjectScope {
    formId: string;
}

/** A validated value: strings, numbers (number fields) and booleans (checkboxes) only. */
export type FormSubmissionValue = string | number | boolean;

export interface NewFormSubmission {
    publishId: string;
    snapshotId: string;
    /** Values validated against the deployed manifest's form definition. */
    fields: Record<string, FormSubmissionValue>;
    /** Version of the project privacy notice in force when the visitor submitted. */
    privacyNoticeVersion: string;
    /** sha256(salt + IP). The raw IP is never stored. */
    ipHash: string;
}

export interface FormSubmission extends FormSubmissionScope, NewFormSubmission {
    id: string;
    createdAt: Date;
    /** When the record is removed (retention). Absent only on records stored before retention existed. */
    expiresAt?: Date;
    /** Stored size of the field values, in bytes (quota accounting). */
    sizeBytes?: number;
}

/** What a project and one of its forms currently hold, for the quota check. */
export interface FormSubmissionUsage {
    formRecords: number;
    projectRecords: number;
    projectBytes: number;
}

export interface FormSubmissionQuota {
    maxPerForm: number;
    maxPerProject: number;
    maxBytesPerProject: number;
}

export interface FormSubmissionGroup {
    formId: string;
    records: number;
    lastWriteAt?: Date;
}

export interface FormSubmissionListQuery {
    /** One form, or every form of the project when undefined. */
    formId?: string;
    page: number;
    limit: number;
    /** Plain text, matched case-insensitively against string values. Never a query language. */
    search?: string;
}
