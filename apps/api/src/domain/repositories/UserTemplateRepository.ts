import type { UserTemplate, UserTemplateStatus, CreateUserTemplateInput } from "../entities/UserTemplate";

export interface UserTemplateRepository {
    /** All templates owned by a user, optionally filtered by status. */
    findByOwner(ownerId: string, status?: UserTemplateStatus): Promise<UserTemplate[]>;
    /** System-promoted templates visible to a tenant. */
    findSystemTemplates(tenantId: string): Promise<UserTemplate[]>;
    findById(id: string): Promise<UserTemplate | null>;
    create(data: CreateUserTemplateInput): Promise<UserTemplate>;
    /** Transition draft → active and clear expiresAt. */
    activate(id: string): Promise<void>;
    archive(id: string): Promise<void>;
    /** Superadmin only: set isSystem=true and make visible tenant-wide. */
    promoteToSystem(id: string): Promise<void>;
    incrementUsage(id: string): Promise<void>;
}
