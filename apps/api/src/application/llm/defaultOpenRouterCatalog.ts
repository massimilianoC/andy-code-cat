import type { LlmProviderCatalog, PipelineModelRole } from "../../domain/entities/LlmCatalog";
import { decorateSeedModel } from "./modelRegistryPresets";

/**
 * Free models on OpenRouter (no API key spend, limited rate).
 * Models with the `:free` suffix are zero-cost but rate-limited.
 * They cover the chat/coding roles; image-gen and embeddings are
 * intentionally absent — OpenRouter is text-first.
 *
 * When a live OPENROUTER_API_KEY is present, the /llm/providers
 * discovery endpoint will override this list with the actual models
 * available to the account (filtered to text/chat modalities only).
 */
const FREE_DEFAULTS: Array<{ id: string; role: PipelineModelRole; capabilities: string[] }> = [
    // Google Gemma 4 (new generation)
    { id: "google/gemma-4-27b-it:free",  role: "dialogue",      capabilities: ["chat"] },
    { id: "google/gemma-4-9b-it:free",   role: "dialogue_fast", capabilities: ["chat"] },
    // Google Gemma 3
    { id: "google/gemma-3-12b-it:free",  role: "dialogue",      capabilities: ["chat"] },
    { id: "google/gemma-3-4b-it:free",   role: "dialogue_fast", capabilities: ["chat"] },
    // DeepSeek R1 (reasoning, free tier)
    { id: "deepseek/deepseek-r1:free",   role: "quality_check", capabilities: ["chat"] },
    // Meta Llama 4
    { id: "meta-llama/llama-4-scout:free",    role: "dialogue",      capabilities: ["chat"] },
    { id: "meta-llama/llama-4-maverick:free", role: "dialogue",      capabilities: ["chat"] },
    // Mistral free
    { id: "mistralai/mistral-small-3.2-24b-instruct:free", role: "dialogue_fast", capabilities: ["chat"] },
    // Vision (multimodal free)
    { id: "google/gemma-3n-e4b-it:free", role: "vision",        capabilities: ["vision", "chat"] },
    { id: "nvidia/nemotron-nano-9b-v2:free", role: "vision_fast", capabilities: ["chat"] },
    // Coding free
    { id: "nvidia/nemotron-3-nano-30b-a3b:free", role: "coding",      capabilities: ["chat"] },
    { id: "liquid/lfm-2.5-1.2b-instruct:free",   role: "coding_fast", capabilities: ["chat"] },
];

/**
 * Paid models used as PRIMARY defaults when an API key is configured.
 * Credits are consumed but there are no upstream rate limits.
 * IDs must be unique — models covering multiple roles are deduplicated
 * by the runtime; missing roles fall back via the selection chain.
 */
const PAID_DEFAULTS: Array<{ id: string; role: PipelineModelRole; capabilities: string[] }> = [
    // Google Gemma 4 (flagship)
    { id: "google/gemma-4-27b-it",        role: "dialogue",      capabilities: ["chat"] },
    // Google Gemini 2.5
    { id: "google/gemini-2.5-pro",         role: "quality_check", capabilities: ["vision", "chat"] },
    { id: "google/gemini-2.5-flash",       role: "dialogue_fast", capabilities: ["vision", "chat"] },
    // Anthropic Claude
    { id: "anthropic/claude-sonnet-4-5",   role: "coding",        capabilities: ["chat"] },
    { id: "anthropic/claude-3.5-haiku",    role: "coding_fast",   capabilities: ["chat"] },
    { id: "anthropic/claude-opus-4-5",     role: "dialogue",      capabilities: ["chat"] },
    // OpenAI
    { id: "openai/gpt-4o",                 role: "vision",        capabilities: ["vision", "chat"] },
    { id: "openai/gpt-4o-mini",            role: "dialogue",      capabilities: ["vision", "chat"] },
    // Meta Llama 4
    { id: "meta-llama/llama-4-scout",      role: "dialogue",      capabilities: ["chat"] },
    { id: "meta-llama/llama-4-maverick",   role: "dialogue",      capabilities: ["chat"] },
    // DeepSeek (paid)
    { id: "deepseek/deepseek-r1",          role: "quality_check", capabilities: ["chat"] },
    { id: "deepseek/deepseek-chat-v3-0324",role: "dialogue",      capabilities: ["chat"] },
    // Mistral
    { id: "mistralai/mistral-large-2411",  role: "coding",        capabilities: ["chat"] },
];

export function buildDefaultOpenRouterCatalog(
    baseUrl: string,
    hasApiKey: boolean
): LlmProviderCatalog {
    const now = new Date();
    const models: LlmProviderCatalog["models"] = [];

    if (hasApiKey) {
        // With credits: paid models come FIRST and are the defaults.
        // Free models are registered only as fallbacks — they have
        // fixed upstream rate limits regardless of credit balance.
        const seen = new Set<string>();
        PAID_DEFAULTS.forEach((m) => {
            if (seen.has(m.id)) return;
            seen.add(m.id);
            models.push(decorateSeedModel({
                id: m.id,
                provider: "openrouter",
                role: m.role,
                capabilities: m.capabilities,
                isDefault: true,
                isFallback: false,
                isActive: true,
            }));
        });
        FREE_DEFAULTS.forEach((m) => {
            if (seen.has(m.id)) return;
            seen.add(m.id);
            models.push(decorateSeedModel({
                id: m.id,
                provider: "openrouter",
                role: m.role,
                capabilities: m.capabilities,
                isDefault: false,
                isFallback: true,
                isActive: true,
            }));
        });
    } else {
        // No key: only free models available
        FREE_DEFAULTS.forEach((m, index) => {
            models.push(decorateSeedModel({
                id: m.id,
                provider: "openrouter",
                role: m.role,
                capabilities: m.capabilities,
                isDefault: index === 0,
                isFallback: index !== 0,
                isActive: true,
            }));
        });
    }

    return {
        provider: "openrouter",
        baseUrl,
        apiType: "openai-compatible",
        authType: "bearer",
        isActive: true,
        models,
        createdAt: now,
        updatedAt: now,
    };
}
