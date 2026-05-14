import type { ServiceApiKey, ServiceCategory, ServiceApiKeyOwnerType } from "../entities/ServiceApiKey";

export interface CreateServiceApiKeyInput {
    service: string;
    label: string;
    category: ServiceCategory;
    ownerType: ServiceApiKeyOwnerType;
    ownerUserId?: string;
    /** Plain-text key — caller must NOT store this; repository encrypts before persisting */
    plaintextKey: string;
    enabled?: boolean;
    supportsVideo?: boolean;
    isDefault?: boolean;
    createdByUserId: string;
}

export interface UpdateServiceApiKeyInput {
    label?: string;
    enabled?: boolean;
    supportsVideo?: boolean;
    isDefault?: boolean;
    /** If provided, the stored key is re-encrypted with the new value */
    plaintextKey?: string;
}

export interface ServiceApiKeyRepository {
    /** Find all platform-scoped keys (ownerType === "platform") */
    findAllPlatform(): Promise<ServiceApiKey[]>;
    /** Find all keys for a specific user (ownerType === "user") */
    findByUserId(userId: string): Promise<ServiceApiKey[]>;
    findById(id: string): Promise<ServiceApiKey | null>;
    /** Find the active default key for a service slug (platform scope first, then user override) */
    findActiveByService(service: string, userId?: string): Promise<ServiceApiKey | null>;
    create(input: CreateServiceApiKeyInput): Promise<ServiceApiKey>;
    update(id: string, input: UpdateServiceApiKeyInput): Promise<ServiceApiKey>;
    delete(id: string): Promise<void>;
    /** Resolve plain-text key — decrypts on-the-fly, never stored in entity */
    resolvePlaintext(key: ServiceApiKey): Promise<string>;
}
