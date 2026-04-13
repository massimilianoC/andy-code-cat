import type { UserLimits } from "./User";

/**
 * Singleton platform-wide configuration document.
 * Stored in the `platform_config` collection under id "global".
 */
export interface PlatformConfig {
    id: string;
    /** When false, the public POST /v1/auth/register endpoint returns 403. */
    registrationOpen: boolean;
    /** When true, newly registered users must verify their email before accessing the platform. */
    emailVerificationRequired: boolean;
    /** Default resource limits assigned to every new user at registration time. */
    defaultUserLimits: UserLimits;
    updatedAt: Date;
    /** userId of the superadmin that last modified this config. */
    updatedByUserId?: string;
}
