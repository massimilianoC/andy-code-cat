import type {
    FormSubmission,
    FormSubmissionGroup,
    FormSubmissionListQuery,
    FormSubmissionProjectScope,
    FormSubmissionScope,
    NewFormSubmission,
} from "../entities/FormSubmission";

/**
 * Port of the shared `form_submissions` collection. Every method takes a whole scope and the
 * implementation spreads it into every filter; no method accepts a free-form filter.
 */
export interface FormSubmissionRepository {
    create(scope: FormSubmissionScope, submission: NewFormSubmission): Promise<FormSubmission>;
    /** Forms of the project that have submissions, with counts. */
    groups(scope: FormSubmissionProjectScope): Promise<FormSubmissionGroup[]>;
    /** Newest first. */
    list(scope: FormSubmissionProjectScope, query: FormSubmissionListQuery): Promise<{ items: FormSubmission[]; total: number }>;
    /** Newest first, at most `max`. */
    listNewest(scope: FormSubmissionProjectScope, formId: string | undefined, max: number): Promise<FormSubmission[]>;
    deleteById(scope: FormSubmissionProjectScope, submissionId: string): Promise<boolean>;
    /** One form, or every form of the project when formId is undefined. Returns how many were removed. */
    deleteMany(scope: FormSubmissionProjectScope, formId?: string): Promise<number>;
}
