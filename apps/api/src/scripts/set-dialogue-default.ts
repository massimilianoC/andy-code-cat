/**
 * Makes one model the `dialogue` default of its provider — the model a user gets when they have
 * not chosen one (see `resolvePlatformDefault`).
 *
 * The same write as "Set default" in /admin/models (`upsertModel`), for when the panel is not at
 * hand during a deploy. It refuses rather than guesses: the provider must exist and be active in
 * `llm_providers`, and the model must be in the provider's live /models listing.
 *
 * Usage (inside the api container):
 *   node apps/api/dist/scripts/set-dialogue-default.js openrouter google/gemini-3.8-flash
 *
 * The provider's default only becomes the platform default when that provider is
 * LLM_DEFAULT_PROVIDER, or when no other provider offers a dialogue default.
 */
import { env } from "../config";
import { closeDb } from "../infra/db/mongo";
import { MongoLlmCatalogRepository } from "../infra/repositories/MongoLlmCatalogRepository";

function dialogueDefaultOf(models: { id: string; role?: string; isDefault?: boolean; isActive?: boolean }[]): string {
    return models.find((model) => model.role === "dialogue" && model.isDefault && model.isActive)?.id ?? "(none)";
}

async function run() {
    const [providerName, modelId] = process.argv.slice(2);
    if (!providerName || !modelId) {
        throw new Error("Usage: set-dialogue-default <provider> <modelId>");
    }

    const repository = new MongoLlmCatalogRepository();
    const provider = (await repository.listAllProviders()).find((entry) => entry.provider === providerName);
    if (!provider) throw new Error(`Provider "${providerName}" is not in llm_providers.`);
    if (!provider.isActive) throw new Error(`Provider "${providerName}" is not active; activate it in /admin/models first.`);

    const apiKey = env.providerApiKeys[providerName];
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Provider /models answered ${response.status}; not changing anything.`);
    const listed = ((await response.json()) as { data?: { id?: string }[] }).data ?? [];
    if (!listed.some((entry) => entry.id === modelId)) {
        throw new Error(`"${modelId}" is not offered by ${providerName} right now; not changing anything.`);
    }

    console.log(`[set-dialogue-default] ${providerName} dialogue default before: ${dialogueDefaultOf(provider.models)}`);
    const updated = await repository.upsertModel({
        provider: providerName,
        modelId,
        patch: { isActive: true, isDefault: true, role: "dialogue" },
    });
    console.log(`[set-dialogue-default] ${providerName} dialogue default after:  ${dialogueDefaultOf(updated.models)}`);
    console.log(`[set-dialogue-default] LLM_DEFAULT_PROVIDER=${env.LLM_DEFAULT_PROVIDER}`);
}

run()
    .then(async () => {
        await closeDb();
    })
    .catch(async (error) => {
        console.error("[set-dialogue-default] failed:", error instanceof Error ? error.message : error);
        await closeDb().catch(() => undefined);
        process.exit(1);
    });
