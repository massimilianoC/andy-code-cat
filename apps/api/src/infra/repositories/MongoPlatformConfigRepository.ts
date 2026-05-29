import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import { DEFAULT_PROMPT_TASK_SETTINGS, type PlatformConfig, type PlatformCostRates } from "../../domain/entities/PlatformConfig";
import type { PlatformConfigRepository, UpdatePlatformConfigInput } from "../../domain/repositories/PlatformConfigRepository";
import { DEFAULT_USER_LIMITS } from "../../domain/entities/User";

const COLLECTION = "platform_config";
const SINGLETON_ID = "global";

interface PlatformConfigDocument {
    _id: string;
    registrationOpen: boolean;
    emailVerificationRequired: boolean;
    defaultUserLimits: PlatformConfig["defaultUserLimits"];
    governanceByProduct?: PlatformConfig["governanceByProduct"];
    updatedAt: Date;
    updatedByUserId?: string;
    costRates?: PlatformCostRates;
    mediaProviderPolicy?: PlatformConfig["mediaProviderPolicy"];
}

function toEntity(doc: PlatformConfigDocument): PlatformConfig {
    return {
        id: doc._id,
        registrationOpen: doc.registrationOpen,
        emailVerificationRequired: doc.emailVerificationRequired,
        defaultUserLimits: doc.defaultUserLimits,
        governanceByProduct: doc.governanceByProduct,
        updatedAt: doc.updatedAt,
        updatedByUserId: doc.updatedByUserId,
        costRates: doc.costRates,
        mediaProviderPolicy: doc.mediaProviderPolicy,
    };
}

const DEFAULT_PRODUCT_GOVERNANCE: NonNullable<PlatformConfig["governanceByProduct"]>[string] = {
    promptTemplates: {
        generationSystem: "",
        focusedEditSystem: "",
        reviewSystem: "",
    },
    promptTaskSettings: {
        ...DEFAULT_PROMPT_TASK_SETTINGS,
    },
    injections: {
        headHtml: "",
        headerHtml: "",
        footerHtml: "",
        scriptInHead: "",
        scriptBeforeBodyClose: "",
        globalCss: "",
        googleTagManagerId: "",
        googleAnalyticsId: "",
        matomoSiteId: "",
        matomoUrl: "",
    },
    cookieBanner: {
        enabled: false,
        position: "bottom",
        texts: {},
    },
    legal: {
        privacyPolicyUrls: {},
        cookiePolicyUrls: {},
        privacyPolicyHtml: {},
        cookiePolicyHtml: {},
    },
    nginx: {
        publicDomain: "",
        publishSubdomainPattern: "{publishId}",
        cacheTtlSeconds: 300,
        clientMaxBodySizeMb: 20,
        extraServerDirectives: "",
    },
};

/** Safe defaults applied when the config document does not yet exist in DB. */
const CONFIG_DEFAULTS: Omit<PlatformConfigDocument, "_id" | "updatedAt"> = {
    registrationOpen: true,
    emailVerificationRequired: false,
    defaultUserLimits: { ...DEFAULT_USER_LIMITS },
    governanceByProduct: {},
};

export class MongoPlatformConfigRepository implements PlatformConfigRepository {
    private async col(): Promise<Collection<PlatformConfigDocument>> {
        const db = await getDb();
        return db.collection<PlatformConfigDocument>(COLLECTION);
    }

    async get(): Promise<PlatformConfig | null> {
        const col = await this.col();
        const doc = await col.findOne({ _id: SINGLETON_ID });
        return doc ? toEntity(doc) : null;
    }

    async upsert(input: UpdatePlatformConfigInput): Promise<PlatformConfig> {
        const col = await this.col();
        const now = new Date();

        // Merge defaultUserLimits partially if provided
        const existingDoc = await col.findOne({ _id: SINGLETON_ID });
        const baseLimits = existingDoc?.defaultUserLimits ?? { ...DEFAULT_USER_LIMITS };
        const mergedLimits = input.defaultUserLimits
            ? { ...baseLimits, ...input.defaultUserLimits }
            : baseLimits;

        const existingGovernance = existingDoc?.governanceByProduct ?? {};
        const mergedGovernance: PlatformConfigDocument["governanceByProduct"] = { ...existingGovernance };

        if (input.governanceByProduct) {
            for (const [productKey, patch] of Object.entries(input.governanceByProduct)) {
                const base = existingGovernance[productKey] ?? DEFAULT_PRODUCT_GOVERNANCE;
                mergedGovernance[productKey] = {
                    promptTemplates: {
                        ...base.promptTemplates,
                        ...(patch.promptTemplates ?? {}),
                    },
                    promptTaskSettings: Object.fromEntries(
                        Object.entries({ ...DEFAULT_PROMPT_TASK_SETTINGS, ...(base.promptTaskSettings ?? {}), ...(patch.promptTaskSettings ?? {}) }).map(([taskKey, task]) => {
                            const defaults = (DEFAULT_PROMPT_TASK_SETTINGS[taskKey] ?? DEFAULT_PROMPT_TASK_SETTINGS.optimize_user_prompt)!;
                            return [
                                taskKey,
                                {
                                    enabled: task?.enabled ?? defaults.enabled,
                                    provider: task?.provider ?? defaults.provider,
                                    model: task?.model ?? defaults.model,
                                    temperature: task?.temperature ?? defaults.temperature,
                                    maxCompletionTokens: task?.maxCompletionTokens ?? defaults.maxCompletionTokens,
                                    systemTemplate: task?.systemTemplate ?? defaults.systemTemplate,
                                },
                            ];
                        }),
                    ),
                    injections: {
                        ...base.injections,
                        ...(patch.injections ?? {}),
                    },
                    cookieBanner: {
                        ...(base.cookieBanner ?? { enabled: false, position: "bottom", texts: {} }),
                        ...(patch.cookieBanner ?? {}),
                    },
                    legal: {
                        ...(base.legal ?? { privacyPolicyUrls: {}, cookiePolicyUrls: {}, privacyPolicyHtml: {}, cookiePolicyHtml: {} }),
                        ...(patch.legal ?? {}),
                    },
                    nginx: {
                        ...base.nginx,
                        ...(patch.nginx ?? {}),
                    },
                };
            }
        }

        const setFields: Partial<PlatformConfigDocument> = {
            updatedAt: now,
            defaultUserLimits: mergedLimits,
            governanceByProduct: mergedGovernance,
        };
        if (input.registrationOpen !== undefined) {
            setFields.registrationOpen = input.registrationOpen;
        }
        if (input.emailVerificationRequired !== undefined) {
            setFields.emailVerificationRequired = input.emailVerificationRequired;
        }
        if (input.updatedByUserId !== undefined) {
            setFields.updatedByUserId = input.updatedByUserId;
        }
        if (input.costRates !== undefined) {
            const existingRates = existingDoc?.costRates;
            const inputRates = input.costRates;
            // Deep-merge perType: new entries are merged key by key with existing ones
            let mergedPerType: PlatformCostRates["perType"] = existingRates?.perType;
            if (inputRates.perType !== undefined) {
                mergedPerType = { ...(existingRates?.perType ?? {}), ...inputRates.perType };
            }
            setFields.costRates = {
                ...existingRates,
                ...inputRates,
                perType: mergedPerType,
                updatedAt: new Date(),
                updatedByUserId: inputRates.updatedByUserId ?? input.updatedByUserId,
            } as PlatformCostRates;
        }
        if (input.mediaProviderPolicy !== undefined) {
            setFields.mediaProviderPolicy = {
                ...(existingDoc?.mediaProviderPolicy ?? {}),
                ...input.mediaProviderPolicy,
                stockImage: {
                    ...(existingDoc?.mediaProviderPolicy?.stockImage ?? {}),
                    ...(input.mediaProviderPolicy.stockImage ?? {}),
                },
            } as PlatformConfig["mediaProviderPolicy"];
        }

        await col.updateOne(
            { _id: SINGLETON_ID },
            {
                $set: setFields,
                $setOnInsert: {
                    _id: SINGLETON_ID,
                    registrationOpen: CONFIG_DEFAULTS.registrationOpen,
                    emailVerificationRequired: CONFIG_DEFAULTS.emailVerificationRequired,
                },
            },
            { upsert: true }
        );

        const updated = await col.findOne({ _id: SINGLETON_ID });
        if (!updated) {
            throw new Error("Failed to load platform config after upsert");
        }
        return toEntity(updated);
    }
}
