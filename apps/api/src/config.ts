import path from "path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

// Load .env from monorepo root regardless of cwd
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

// Default DATA_DIR: monorepo root's /data — works both locally and in Docker
// (__dirname = apps/api/src → ../../../ = monorepo root)
const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../../data");

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().default(4000),
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
    LLM_DEFAULT_MAX_COMPLETION_TOKENS: z.coerce.number().int().positive().default(24000),
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
    LMSTUDIO_BASE_URL: z.string().url().default("http://192.168.1.78:1234/v1"),
    SILICONFLOW_BASE_URL: z.string().url().default("https://api.siliconflow.com/v1"),
    SILICONFLOW_API_KEY: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    OPEN_ROUTER_API_KEY: z.string().optional(),
    LLM_PROVIDER_API_KEYS_JSON: z.string().optional(),
    COST_POLICY_TEXT_EUR_PER_1K_TOKENS: z.coerce.number().nonnegative().default(0.005),
    COST_POLICY_IMAGE_EUR_PER_ASSET: z.coerce.number().nonnegative().default(0.1),
    COST_POLICY_VIDEO_EUR_PER_ASSET: z.coerce.number().nonnegative().default(0.2),
    /** USD → EUR conversion rate used when provider reports actual cost in USD. */
    COST_POLICY_USD_TO_EUR_RATE: z.coerce.number().positive().default(0.92),
    /** Multiplier applied on top of provider-reported EUR cost (1.1 = +10% safety margin). */
    COST_POLICY_PROVIDER_MARKUP_FACTOR: z.coerce.number().positive().default(1.1),
    // --- Public domain (used to build subdomain URLs for published sites) ---
    // Set to the base domain (e.g. sitowebinun.click) when nginx wildcard is active.
    // If unset, only the path-based URL (/p/{publishId}) is returned.
    PUBLIC_DOMAIN: z.string().optional(),
    // --- CORS ---
    // Comma-separated list of allowed origins, or "*" for development.
    // Production example: https://app.sitowebinun.click
    CORS_ORIGIN: z.string().default("*"),
    // --- File storage & export ---
    DATA_DIR: z.string().default(DEFAULT_DATA_DIR),
    EXPORT_JWT_SECRET: z.string().min(16).default("change-me-export-secret-32chars!!"),
    EXPORT_DOWNLOAD_TTL: z.string().default("3600"),
    UPLOAD_MAX_SIZE_BYTES: z.coerce.number().int().positive().default(20 * 1024 * 1024),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("Invalid environment configuration", parsed.error.format());
    process.exit(1);
}

export const env = {
    ...parsed.data,
    authBypassEmailVerification: parsed.data.AUTH_BYPASS_EMAIL_VERIFICATION === "true",
    llmAutoSeedOnStartup: parsed.data.LLM_AUTO_SEED_ON_STARTUP === "true",
    hasSiliconFlowApiKey: Boolean(parsed.data.SILICONFLOW_API_KEY?.trim()),
    hasOpenRouterApiKey: Boolean(parsed.data.OPEN_ROUTER_API_KEY?.trim()),
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
};
