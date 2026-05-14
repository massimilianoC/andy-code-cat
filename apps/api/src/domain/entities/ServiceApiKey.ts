/**
 * ServiceApiKey — stores an encrypted external API key for a named service
 * (e.g. pexels, pixabay, unsplash, openrouter, siliconflow).
 *
 * Encryption: AES-256-GCM, master key derived via HKDF-SHA256 at runtime.
 * The plain-text key is NEVER persisted; only the ciphertext + iv + authTag.
 *
 * Scope model:
 *   - ownerType "platform" → global default, used when no user override exists
 *   - ownerType "user"     → BYOK override scoped to a specific userId (future)
 */
export type ServiceApiKeyOwnerType = "platform" | "user";

export type ServiceCategory = "image" | "video" | "llm" | "other";

export interface ServiceApiKey {
    id: string;
    /** Logical service identifier (lowercase slug): pexels | pixabay | unsplash | siliconflow | openrouter … */
    service: string;
    /** Human-readable label for admin UI */
    label: string;
    category: ServiceCategory;
    ownerType: ServiceApiKeyOwnerType;
    /** Present only when ownerType === "user" */
    ownerUserId?: string;
    /** AES-256-GCM ciphertext encoded as base64 */
    encryptedKey: string;
    /** AES-256-GCM IV encoded as base64 */
    iv: string;
    /** AES-256-GCM auth tag encoded as base64 */
    authTag: string;
    /** Whether this key is active and should be preferred over env fallback */
    enabled: boolean;
    /** Whether this service supports video assets (Pexels, Pixabay) */
    supportsVideo: boolean;
    /** Whether this is the default service for its category (one per category per scope) */
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdByUserId: string;
}
