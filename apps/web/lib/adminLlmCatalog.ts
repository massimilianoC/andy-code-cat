import type { AdminLlmProviderDto, PromptTaskSettingDto } from "@/lib/api/admin";

type Capability = "chat" | "vision" | "image_generation" | "video_generation" | "tools" | "embeddings";

function sortModelsByPreferredCapability(
    models: AdminLlmProviderDto["models"],
    preferredCapability?: Capability,
) {
    return [...models].sort((left, right) => {
        const leftScore = Number(Boolean(preferredCapability && left.capabilities.includes(preferredCapability))) + Number(left.isDefault);
        const rightScore = Number(Boolean(preferredCapability && right.capabilities.includes(preferredCapability))) + Number(right.isDefault);
        if (rightScore !== leftScore) {
            return rightScore - leftScore;
        }
        return (left.displayName ?? left.id).localeCompare(right.displayName ?? right.id);
    });
}

function pickProviderDefaultModel(provider: AdminLlmProviderDto, preferredCapability?: Capability) {
    return provider.models.find((model) => model.isDefault && (!preferredCapability || model.capabilities.includes(preferredCapability)) && model.role === "dialogue")
        ?? provider.models.find((model) => model.isDefault && (!preferredCapability || model.capabilities.includes(preferredCapability)))
        ?? provider.models.find((model) => !preferredCapability || model.capabilities.includes(preferredCapability))
        ?? provider.models[0];
}

export function filterProvidersByCapability(
    providers: AdminLlmProviderDto[],
    requiredCapability: Capability = "chat",
): AdminLlmProviderDto[] {
    return providers
        .filter((provider) => provider.isActive)
        .map((provider) => ({
            ...provider,
            models: sortModelsByPreferredCapability(
                provider.models.filter((model) => model.isActive),
                requiredCapability,
            ),
        }))
        .filter((provider) => provider.models.length > 0);
}

export function resolvePromptTaskSettingAgainstCatalog(
    task: PromptTaskSettingDto,
    providers: AdminLlmProviderDto[],
    options?: {
        preferredProvider?: string;
        requiredCapability?: Capability;
    },
): PromptTaskSettingDto {
    const eligibleProviders = filterProvidersByCapability(providers, options?.requiredCapability ?? "chat");
    if (eligibleProviders.length === 0) {
        return task;
    }

    const provider = eligibleProviders.find((entry) => entry.provider === task.provider)
        ?? eligibleProviders.find((entry) => entry.provider === options?.preferredProvider)
        ?? eligibleProviders[0];

    if (!provider) {
        return task;
    }

    const model = provider.models.find((entry) => entry.id === task.model)
        ?? pickProviderDefaultModel(provider, options?.requiredCapability)
        ?? provider.models[0];

    return {
        ...task,
        provider: provider.provider,
        model: model?.id ?? task.model,
    };
}