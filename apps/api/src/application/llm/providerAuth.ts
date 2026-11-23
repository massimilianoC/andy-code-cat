/**
 * Provider credentials, resolved from the environment. Shared by the LLM routes (provider status
 * in the catalog) and by `GenerateArtifact` (the Authorization header of the generation call), so
 * the two can never disagree about whether a provider has a key.
 */
import { env } from "../../config";
import { HttpError } from "../../presentation/http/errors/httpError";
import type { LlmRuntimeContext } from "../use-cases/ResolvePromptExecution";

export type LlmProviderStatus = {
    requiresKey: boolean;
    hasApiKeyConfigured: boolean;
    keyEnvironmentVariable?: string;
};

const PROVIDER_KEY_ENV_HINTS: Record<string, string> = {
    siliconflow: "SILICONFLOW_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
};

export function getProviderStatus(providerKey: string, authType?: "api-key" | "bearer" | "none"): LlmProviderStatus {
    const requiresKey = authType !== "none";
    return {
        requiresKey,
        hasApiKeyConfigured: requiresKey ? Boolean(env.providerApiKeys[providerKey]) : true,
        keyEnvironmentVariable: requiresKey ? (PROVIDER_KEY_ENV_HINTS[providerKey] ?? "LLM_PROVIDER_API_KEYS_JSON") : undefined,
    };
}

export function resolveProviderAuthHeader(providerKey: string, authType?: "api-key" | "bearer" | "none"): string | undefined {
    if (authType === "none") {
        return undefined;
    }

    const key = env.providerApiKeys[providerKey];
    if (!key) {
        return undefined;
    }

    const kind = authType ?? "bearer";
    return kind === "api-key" ? key : `Bearer ${key}`;
}

export function buildProviderApiKeyMissingError(context: LlmRuntimeContext): HttpError {
    const providerStatus = getProviderStatus(context.providerCatalog.provider, context.providerCatalog.authType);
    return new HttpError(`Missing API key for provider ${context.providerCatalog.provider}`, {
        statusCode: 503,
        code: "LLM_PROVIDER_API_KEY_MISSING",
        userMessage: `Il provider ${context.providerCatalog.provider} richiede una API key che non e configurata.`,
        details: {
            provider: context.providerCatalog.provider,
            model: context.modelId,
            authType: context.providerCatalog.authType,
            keyEnvironmentVariable: providerStatus.keyEnvironmentVariable,
        },
    });
}

export function buildProviderResponseError(input: {
    statusCode: number;
    code: string;
    message: string;
    userMessage: string;
    provider: string;
    model: string;
    providerStatus?: number;
    providerBody?: unknown;
}): HttpError {
    return new HttpError(input.message, {
        statusCode: input.statusCode,
        code: input.code,
        userMessage: input.userMessage,
        details: {
            provider: input.provider,
            model: input.model,
            providerStatus: input.providerStatus,
            providerBody: input.providerBody,
        },
    });
}
