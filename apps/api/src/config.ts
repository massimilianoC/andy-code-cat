import path from "path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// Load .env from monorepo root regardless of cwd
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

// Default DATA_DIR: monorepo root's /data — works both locally and in Docker
// (__dirname = apps/api/src → ../../../ = monorepo root)
const MONOREPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_DATA_DIR = path.resolve(MONOREPO_ROOT, "data");
const DEFAULT_TEMPLATE_SKILLS_ROOT = path.resolve(MONOREPO_ROOT, "docs/skills/template-skills");
const DEFAULT_SILICONFLOW_IMAGE_MODEL = "black-forest-labs/FLUX.1-schnell";
const DEFAULT_SILICONFLOW_IMAGE_SIZE = "1024x1024";

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().default(4000),
    /** Reverse-proxy hops in front of the API (see app.ts). 1 = the stack's own nginx. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
    PUBLIC_API_BASE_URL: z.string().url().optional(),
    MONGODB_URI: z.string().min(1),
    MONGODB_DB_NAME: z.string().min(1).default("andy-code-cat"),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.string().default("2h"),
    JWT_REFRESH_TTL: z.string().default("30d"),
    AUTH_BYPASS_EMAIL_VERIFICATION: z.string().default("true"),
    LLM_CATALOG_SOURCE: z.enum(["env", "mongo"]).default("env"),
    LLM_AUTO_SEED_ON_STARTUP: z.string().default("true"),
    LLM_DEFAULT_PROVIDER: z.string().default("siliconflow"),
    LLM_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(64000),
    LLM_ARTIFACT_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(16000),
    LLM_MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(12),
    LLM_HISTORY_MESSAGE_MAX_CHARS: z.coerce.number().int().positive().default(2000),
    LLM_HISTORY_MAX_CHARS: z.coerce.number().int().positive().default(7000),
    // Generation output budget. The route ceiling is already 64k; this default is what
    // actually clamped it, and a reasoning model spends thousands of these tokens thinking
    // before the first character of the artifact — artifacts with thinking have been
    // observed well past 24k. Raised to the ceiling so the two agree.
    LLM_DEFAULT_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(64000),
    // --- Template Skills Layer S (filesystem-first) ---
    LLM_TEMPLATE_SKILLS_ENABLED: z.string().default("true"),
    LLM_TEMPLATE_SKILLS_ROOT: z.string().default(DEFAULT_TEMPLATE_SKILLS_ROOT),
    LLM_TEMPLATE_SKILLS_MAX_CHARS: z.coerce.number().int().positive().default(12000),
    // --- Section-aware focus context (experimental, backward-compatible) ---
    /** Enable section-level context extraction for focused-edit requests. */
    LLM_FOCUS_SECTION_CONTEXT: z.string().default("false"),
    /** Max chars for the focused section HTML sent to the LLM (replaces LLM_ARTIFACT_CONTEXT_MAX_CHARS in section mode). */
    LLM_FOCUS_SECTION_HTML_MAX_CHARS: z.coerce.number().int().positive().default(8000),
    /** History strategy when LLM_FOCUS_SECTION_CONTEXT is active.
     *  full       — send full history (same as today)
     *  user_only  — send only user messages (strips assistant HTML artifacts from history)
     *  none       — send no history (maximum token savings)
     */
    LLM_FOCUS_HISTORY_MODE: z.enum(["full", "user_only", "none"]).default("none"),
    LLM_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(167000),
    LMSTUDIO_BASE_URL: z.string().url().default("http://localhost:1234/v1"),
    SILICONFLOW_BASE_URL: z.string().url().default("https://api.siliconflow.com/v1"),
    SILICONFLOW_API_KEY: z.string().optional(),
    SILICONFLOW_IMAGE_MODEL: z.string().default(DEFAULT_SILICONFLOW_IMAGE_MODEL),
    SILICONFLOW_IMAGE_SIZE: z.string().default(DEFAULT_SILICONFLOW_IMAGE_SIZE),
    SILICONFLOW_IMAGE_STEPS: z.coerce.number().int().positive().default(4),
    SILICONFLOW_IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
    OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    OPEN_ROUTER_API_KEY: z.string().optional(),
    LLM_PROVIDER_API_KEYS_JSON: z.string().optional(),
    // --- External image services ---
    PEXELS_API_KEY: z.string().optional(),
    PIXABAY_API_KEY: z.string().optional(),
    UNSPLASH_ACCESS_KEY: z.string().optional(),
    IMAGE_STOCK_PERSIST_STRICT: z.string().default("false"),
    COST_POLICY_TEXT_EUR_PER_1K_TOKENS: z.coerce.number().nonnegative().default(0.005),
    COST_POLICY_IMAGE_EUR_PER_ASSET: z.coerce.number().nonnegative().default(0.1),
    COST_POLICY_VIDEO_EUR_PER_ASSET: z.coerce.number().nonnegative().default(0.2),
    /** USD → EUR conversion rate used when provider reports actual cost in USD. */
    COST_POLICY_USD_TO_EUR_RATE: z.coerce.number().positive().default(0.92),
    /** Multiplier applied on top of provider-reported EUR cost (1.1 = +10% safety margin). */
    COST_POLICY_PROVIDER_MARKUP_FACTOR: z.coerce.number().positive().default(1.1),
    // --- CORS ---
    // Comma-separated list of allowed origins, or "*" for development.
    // Production example: https://app.yourdomain.com
    CORS_ORIGIN: z.string().default("*"),
    // --- File storage & export ---
    DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
    STORAGE_ADAPTER: z.enum(["local", "minio"]).default("local"),
    MINIO_ENDPOINT: z.string().default("localhost"),
    MINIO_PORT: z.coerce.number().int().positive().default(9000),
    MINIO_USE_SSL: z.string().default("false"),
    MINIO_ACCESS_KEY: z.string().default("minioadmin"),
    MINIO_SECRET_KEY: z.string().default("minioadmin"),
    MINIO_BUCKET: z.string().default("andy-code-cat-media"),
    MINIO_REGION: z.string().default("us-east-1"),
    MINIO_ROOT_PREFIX: z.string().default("andy-code-cat"),
    MEDIA_AUTO_CLASSIFY_UPLOADS: z.string().default("true"),
    MEDIA_CLASSIFIER_MODEL: z.string().default("heuristic-media-classifier-v1"),
    EXPORT_JWT_SECRET: z.string().min(16).default("change-me-export-secret-32chars!!"),
    EXPORT_DOWNLOAD_TTL: z.string().default("3600"),
    // Salt of the IP hash stored with captured form submissions (FORMS_CAPTURE.md). Optional:
    // when unset it is derived from EXPORT_JWT_SECRET. Changing it only affects new submissions.
    FORM_IP_HASH_SALT: z.string().optional(),
    UPLOAD_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
    // ── Document Context Layer (DCL) enrichment ───────────────────────────────
    ENRICHMENT_ENABLED: z.string().default("true"),
    ENRICHMENT_DOCUMENT_PARSING: z.string().default("true"),
    ENRICHMENT_DOCUMENT_LLM_PASS: z.string().default("true"),
    ENRICHMENT_TEXT_PROVIDER: z.string().default("siliconflow"),
    ENRICHMENT_TEXT_MODEL: z.string().default("Qwen/Qwen2.5-72B-Instruct"),
    ENRICHMENT_IMAGE_ANALYSIS: z.string().default("true"),
    ENRICHMENT_VISION_PROVIDER: z.string().default("siliconflow"),
    ENRICHMENT_VISION_MODEL: z.string().default("Qwen/Qwen3-VL-32B-Instruct"),
    ENRICHMENT_INJECT_LAYER_D: z.string().default("true"),
    ENRICHMENT_LAYER_D_MAX_CHARS: z.coerce.number().int().positive().default(21000),
    ENRICHMENT_LAYER_D_MAX_ASSETS: z.coerce.number().int().positive().default(5),
    // ── VibeCore pipeline flags ───────────────────────────────────────────────
    VIBE_CLASSIFIER_ENABLED: z.string().default("true"),
    // ── Background runs (docs/specs/BACKGROUND_RUNS.md) — limits, not switches ─
    /** Cost a single background run may spend, in EUR, checked against the journal after each LLM call. */
    BACKGROUND_RUN_MAX_COST_EUR: z.coerce.number().positive().default(0.5),
    /** Runs a user may have queued or in progress at once. */
    BACKGROUND_RUN_MAX_PER_USER: z.coerce.number().int().positive().default(2),
    /** Runs the worker pool executes at once (whole installation). */
    BACKGROUND_RUN_POOL_SIZE: z.coerce.number().int().positive().default(2),
    /** Lease a worker holds on a run; renewed by a heartbeat every third of it. */
    BACKGROUND_RUN_LEASE_MS: z.coerce.number().int().min(5_000).default(60_000),
    /** How often an idle worker looks for a claimable run. */
    BACKGROUND_RUN_POLL_MS: z.coerce.number().int().min(200).default(5_000),
    /** Claims after which a run that keeps dying is failed instead of retried. */
    BACKGROUND_RUN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    /** Ceiling on one background generation call (the worker's own, there is no client to close). */
    BACKGROUND_RUN_GENERATION_TIMEOUT_MS: z.coerce.number().int().positive().default(25 * 60_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment configuration", parsed.error.format());
    process.exit(1);
}

/**
 * Insecure defaults that are convenient in development and dangerous in production. They are
 * reported loudly at boot instead of failing it, so an existing deployment that relies on one
 * keeps running while its operator fixes the env file. install.sh never produces any of them.
 */
export function insecureProductionSettings(data: {
    NODE_ENV: string;
    CORS_ORIGIN: string;
    EXPORT_JWT_SECRET: string;
    STORAGE_ADAPTER: string;
    MINIO_ACCESS_KEY?: string;
    MINIO_SECRET_KEY?: string;
}): string[] {
    if (data.NODE_ENV !== "production") return [];
    const warnings: string[] = [];
    if (data.CORS_ORIGIN.split(",").some((origin) => origin.trim() === "*")) {
        warnings.push(
            "CORS_ORIGIN contains \"*\": the app hosts cannot be identified, so published sites may run on the app's origin. Set CORS_ORIGIN to the web app URL(s).",
        );
    }
    if (data.EXPORT_JWT_SECRET === "change-me-export-secret-32chars!!") {
        warnings.push("EXPORT_JWT_SECRET uses the public default: export download links can be forged. Set a random value (openssl rand -hex 32).");
    }
    if (
        data.STORAGE_ADAPTER === "minio" &&
        ((data.MINIO_ACCESS_KEY?.trim() || "minioadmin") === "minioadmin" || (data.MINIO_SECRET_KEY?.trim() || "minioadmin") === "minioadmin")
    ) {
        warnings.push("MinIO uses the public minioadmin credentials. Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY.");
    }
    return warnings;
}

for (const warning of insecureProductionSettings(parsed.data)) {
    console.error(`[config] INSECURE PRODUCTION SETTING — ${warning}`);
}

export const env = {
    ...parsed.data,
    PUBLIC_API_BASE_URL: parsed.data.PUBLIC_API_BASE_URL?.trim() || `http://localhost:${parsed.data.API_PORT}`,
    SILICONFLOW_IMAGE_MODEL: parsed.data.SILICONFLOW_IMAGE_MODEL?.trim() || DEFAULT_SILICONFLOW_IMAGE_MODEL,
    SILICONFLOW_IMAGE_SIZE: parsed.data.SILICONFLOW_IMAGE_SIZE?.trim() || DEFAULT_SILICONFLOW_IMAGE_SIZE,
    MINIO_ENDPOINT: parsed.data.MINIO_ENDPOINT?.trim() || "localhost",
    MINIO_ACCESS_KEY: parsed.data.MINIO_ACCESS_KEY?.trim() || "minioadmin",
    MINIO_SECRET_KEY: parsed.data.MINIO_SECRET_KEY?.trim() || "minioadmin",
    authBypassEmailVerification: parsed.data.AUTH_BYPASS_EMAIL_VERIFICATION === "true",
    llmAutoSeedOnStartup: parsed.data.LLM_AUTO_SEED_ON_STARTUP === "true",
    MINIO_USE_SSL: parsed.data.MINIO_USE_SSL === "true",
    MEDIA_AUTO_CLASSIFY_UPLOADS: parsed.data.MEDIA_AUTO_CLASSIFY_UPLOADS === "true",
    hasSiliconFlowApiKey: Boolean(parsed.data.SILICONFLOW_API_KEY?.trim()),
    hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
    hasPexelsApiKey: Boolean(parsed.data.PEXELS_API_KEY?.trim()),
    hasPixabayApiKey: Boolean(parsed.data.PIXABAY_API_KEY?.trim()),
    hasUnsplashApiKey: Boolean(parsed.data.UNSPLASH_ACCESS_KEY?.trim()),
    imageStockPersistStrict: parsed.data.IMAGE_STOCK_PERSIST_STRICT === "true",
    providerApiKeys: (() => {
        const map: Record<string, string> = {};
        if (parsed.data.SILICONFLOW_API_KEY?.trim()) {
            map.siliconflow = parsed.data.SILICONFLOW_API_KEY.trim();
        }
        if (parsed.data.OPEN_ROUTER_API_KEY?.trim()) {
            map.openrouter = parsed.data.OPEN_ROUTER_API_KEY.trim();
        }

        if (!parsed.data.LLM_PROVIDER_API_KEYS_JSON?.trim()) {
            return map;
        }

        try {
            const parsedMap = JSON.parse(parsed.data.LLM_PROVIDER_API_KEYS_JSON);
            if (parsedMap && typeof parsedMap === "object") {
                for (const [key, value] of Object.entries(parsedMap)) {
                    if (typeof value === "string" && value.trim()) {
                        map[key] = value.trim();
                    }
                }
            }
        } catch {
            // Ignore invalid JSON and continue with available provider keys.
        }

        return map;
    })(),
    focusSectionContext: parsed.data.LLM_FOCUS_SECTION_CONTEXT === "true",
    templateSkillsEnabled: parsed.data.LLM_TEMPLATE_SKILLS_ENABLED === "true",
    templateSkillsRoot: path.isAbsolute(parsed.data.LLM_TEMPLATE_SKILLS_ROOT)
        ? parsed.data.LLM_TEMPLATE_SKILLS_ROOT
        : path.resolve(MONOREPO_ROOT, parsed.data.LLM_TEMPLATE_SKILLS_ROOT),
    enrichmentEnabled: parsed.data.ENRICHMENT_ENABLED === "true",
    enrichmentDocumentParsing: parsed.data.ENRICHMENT_DOCUMENT_PARSING === "true",
    enrichmentDocumentLlmPass: parsed.data.ENRICHMENT_DOCUMENT_LLM_PASS === "true",
    enrichmentImageAnalysis: parsed.data.ENRICHMENT_IMAGE_ANALYSIS === "true",
    enrichmentInjectLayerD: parsed.data.ENRICHMENT_INJECT_LAYER_D === "true",
    vibeClassifierEnabled: parsed.data.VIBE_CLASSIFIER_ENABLED === "true",
};
