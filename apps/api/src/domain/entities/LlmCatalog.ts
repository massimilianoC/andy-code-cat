export type PipelineModelRole =
    | "coding"
    | "coding_fast"
    | "dialogue"
    | "dialogue_fast"
    | "vision"
    | "vision_fast"
    | "quality_check"
    | "image_gen"
    | "image_gen_fast"
    | "embeddings";

export interface LlmModel {
    id: string;
    provider: string;
    role: PipelineModelRole;
    capabilities: string[];
    isDefault: boolean;
    isFallback: boolean;
    isActive: boolean;
    /** Friendly label shown in the superadmin registry UI. */
    displayName?: string;
    /** Optional short note to explain when the model should be used. */
    description?: string;
    /** Optional model-specific prompt layer appended to the generation system prompt. */
    promptTemplate?: string;
    /** Optional model-specific prompt layer appended in focused-edit mode. */
    focusPromptTemplate?: string;
    /** Provider-specific OpenAI-compatible supported parameters exposed by live discovery. */
    supportedParameters?: string[];
    /** Cost tier derived from provider pricing data (computed at discovery time via percentile buckets). */
    priceTier?: "free" | "€" | "€€" | "€€€" | "€€€€";
    /** Actual input price in USD per million tokens (0 = free; undefined = unknown). */
    priceInputUsdPerM?: number;
    /** Actual output price in USD per million tokens (0 = free; undefined = unknown). */
    priceOutputUsdPerM?: number;
    /**
     * Whether the provider still lists this model, as of the last reconciliation.
     *
     * Set by `ReconcileLlmCatalogAvailability`, never edited by hand. A model the provider has
     * dropped is marked "deprecated" rather than deleted: its id may already be referenced by a
     * stored PipelineRun model lock, an execution log or a published build, and deleting the row
     * would turn every one of those references into an unresolvable string. Absent on records
     * written before this field existed, which reads as "never checked".
     */
    availability?: "live" | "deprecated";
    /** When availability was last established against the provider. */
    availabilityCheckedAt?: Date;
}

export interface LlmProviderCatalog {
    provider: string;
    baseUrl: string;
    apiType?: "openai-compatible" | "anthropic-compatible" | "custom";
    authType?: "api-key" | "bearer" | "none";
    isActive: boolean;
    models: LlmModel[];
    createdAt: Date;
    updatedAt: Date;
}
