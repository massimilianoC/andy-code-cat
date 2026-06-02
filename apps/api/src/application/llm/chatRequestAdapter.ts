type ChatCompletionMessage = {
    role: string;
    content: string | Array<unknown>;
};

type StructuredOutputMode = "artifact";

const ARTIFACT_RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        chat: {
            type: "object",
            properties: {
                summary: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                nextActions: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "bullets", "nextActions"],
            additionalProperties: false,
        },
        artifacts: {
            type: "object",
            properties: {
                html: { type: "string" },
                css: { type: "string" },
                js: { type: "string" },
            },
            required: ["html", "css", "js"],
            additionalProperties: false,
        },
        mediaManifest: {
            anyOf: [
                {
                    type: "object",
                    properties: {
                        version: { type: "string", enum: ["media-manifest-v1"] },
                        requests: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    key: { type: "string" },
                                    kind: { type: "string", enum: ["image", "background", "logo", "icon", "avatar", "decorative"] },
                                    role: { type: "string", enum: ["hero", "section", "card", "gallery", "testimonial", "avatar", "background", "logo", "icon", "decorative"] },
                                    sourceStrategy: { type: "string", enum: ["auto", "stock", "image_generation", "project_asset", "user_library"] },
                                    semanticQuery: { type: "string" },
                                    generationPrompt: { type: ["string", "null"] },
                                    alt: { type: "string" },
                                    width: { type: ["integer", "null"] },
                                    height: { type: ["integer", "null"] },
                                    aspectRatio: { type: ["number", "null"] },
                                    priority: { type: "integer" },
                                    constraints: {
                                        anyOf: [
                                            {
                                                type: "object",
                                                properties: {
                                                    noText: { type: ["boolean", "null"] },
                                                    noLogo: { type: ["boolean", "null"] },
                                                    safeCrop: { type: ["boolean", "null"] },
                                                    styleTags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
                                                    paletteHints: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
                                                    avoid: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
                                                },
                                                required: ["noText", "noLogo", "safeCrop", "styleTags", "paletteHints", "avoid"],
                                                additionalProperties: false,
                                            },
                                            { type: "null" },
                                        ],
                                    },
                                    context: {
                                        anyOf: [
                                            {
                                                type: "object",
                                                properties: {
                                                    pageSection: { type: ["string", "null"] },
                                                    nearbyHeading: { type: ["string", "null"] },
                                                    nearbyText: { type: ["string", "null"] },
                                                    brandTone: { type: ["string", "null"] },
                                                },
                                                required: ["pageSection", "nearbyHeading", "nearbyText", "brandTone"],
                                                additionalProperties: false,
                                            },
                                            { type: "null" },
                                        ],
                                    },
                                },
                                required: [
                                    "key", "kind", "role", "sourceStrategy", "semanticQuery",
                                    "generationPrompt", "alt", "width", "height", "aspectRatio",
                                    "priority", "constraints", "context",
                                ],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ["version", "requests"],
                    additionalProperties: false,
                },
                { type: "null" },
            ],
        },
        focusPatch: {
            anyOf: [
                {
                    type: "object",
                    properties: {
                        targetType: { type: "string", enum: ["html", "css", "js"] },
                        anchor: { type: ["string", "null"] },
                        replacement: { type: "string" },
                    },
                    required: ["targetType", "anchor", "replacement"],
                    additionalProperties: false,
                },
                { type: "null" },
            ],
        },
    },
    required: ["chat", "artifacts", "mediaManifest", "focusPatch"],
    additionalProperties: false,
};

function supportsSiliconFlowThinking(model: string) {
    return [
        /^Qwen\/Qwen3-(8B|14B|32B)(?:$|-)/i,
        /^Qwen\/Qwen3-30B-A3B(?:$|-)/i,
        /^Qwen\/Qwen3-235B-A22B(?:$|-)/i,
        /^tencent\/Hunyuan-A13B-Instruct$/i,
        /^zai-org\/GLM-5V-Turbo$/i,
        /^zai-org\/GLM-4\.6V$/i,
        /^zai-org\/GLM-4\.5V$/i,
        /^deepseek-ai\/DeepSeek-V3\.1$/i,
        /^deepseek-ai\/DeepSeek-V3\.1-Terminus$/i,
        /^deepseek-ai\/DeepSeek-V3\.2-Exp$/i,
        /^deepseek-ai\/DeepSeek-V3\.2$/i,
    ].some((pattern) => pattern.test(model));
}

function supportsSiliconFlowJsonObject(model: string) {
    return !/^deepseek-ai\/DeepSeek-(?:R1|V3)(?:$|[.-])/i.test(model);
}

function resolveStructuredOutputFields(input: {
    provider: string;
    model: string;
    mode?: StructuredOutputMode;
    supportedParameters?: string[];
}) {
    if (!input.mode) return {};

    const supported = new Set(input.supportedParameters ?? []);
    if (input.provider === "openrouter") {
        if (supported.has("structured_outputs")) {
            return {
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "andy_artifact_response",
                        strict: true,
                        schema: ARTIFACT_RESPONSE_SCHEMA,
                    },
                },
                provider: { require_parameters: true },
            };
        }
        if (supported.has("response_format")) {
            return {
                response_format: { type: "json_object" },
                provider: { require_parameters: true },
            };
        }
        return {};
    }

    if (input.provider === "siliconflow" && supportsSiliconFlowJsonObject(input.model)) {
        return { response_format: { type: "json_object" } };
    }

    return {};
}

export function buildChatCompletionRequestBody(input: {
    provider: string;
    model: string;
    messages: ChatCompletionMessage[];
    maxTokens: number;
    temperature: number;
    stream?: boolean;
    thinkingBudget?: number;
    structuredOutputMode?: StructuredOutputMode;
    supportedParameters?: string[];
}) {
    const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        ...(input.stream ? { stream: true } : {}),
        ...resolveStructuredOutputFields({
            provider: input.provider,
            model: input.model,
            mode: input.structuredOutputMode,
            supportedParameters: input.supportedParameters,
        }),
    };

    if (input.thinkingBudget == null) {
        return body;
    }

    if (input.provider === "siliconflow" && supportsSiliconFlowThinking(input.model)) {
        return {
            ...body,
            enable_thinking: true,
            thinking_budget: input.thinkingBudget,
        };
    }

    return body;
}
