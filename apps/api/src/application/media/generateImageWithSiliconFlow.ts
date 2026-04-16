import { env } from "../../config";
import { getSiliconFlowPrice } from "../llm/siliconflowPricing";

export interface ImageProviderTokenUsage {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
}

export interface SiliconFlowImageGenerationResult {
    provider: "siliconflow";
    model: string;
    imageSize: string;
    numInferenceSteps: number;
    requestedAt: Date;
    completedAt: Date;
    latencyMs: number;
    providerRequestId?: string;
    revisedPrompt?: string;
    finishReason?: string;
    sourceUrl?: string;
    outputMimeType: string;
    width?: number;
    height?: number;
    providerCostUsd?: number;
    tokenUsage?: ImageProviderTokenUsage;
    providerResponse?: Record<string, unknown>;
    buffer: Buffer;
}

function parseTokenUsage(value: unknown): ImageProviderTokenUsage | undefined {
    if (!value || typeof value !== "object") return undefined;
    const usage = value as Record<string, unknown>;
    const promptTokens = typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : undefined;
    const completionTokens = typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : undefined;
    const totalTokens = typeof usage["total_tokens"] === "number"
        ? usage["total_tokens"]
        : ((promptTokens ?? 0) + (completionTokens ?? 0)) || undefined;

    if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
        return undefined;
    }

    return { promptTokens, completionTokens, totalTokens };
}

function sanitizeProviderResponse(body: unknown): Record<string, unknown> | undefined {
    if (!body || typeof body !== "object") return undefined;
    const source = body as Record<string, unknown>;
    const data = Array.isArray(source["data"])
        ? (source["data"] as Array<Record<string, unknown>>).map((item) => ({
            url: typeof item?.["url"] === "string" ? item["url"] : undefined,
            revised_prompt: typeof item?.["revised_prompt"] === "string" ? item["revised_prompt"] : undefined,
            width: typeof item?.["width"] === "number" ? item["width"] : undefined,
            height: typeof item?.["height"] === "number" ? item["height"] : undefined,
        }))
        : undefined;

    return {
        created: source["created"],
        data,
        usage: source["usage"],
    };
}

function inferMimeType(url: string, header: string | null): string {
    if (header?.startsWith("image/")) return header;
    const lower = url.toLowerCase();
    if (lower.includes(".jpg") || lower.includes(".jpeg")) return "image/jpeg";
    if (lower.includes(".webp")) return "image/webp";
    if (lower.includes(".gif")) return "image/gif";
    return "image/png";
}

function parseImageSize(imageSize: string): { width?: number; height?: number } {
    const match = imageSize.match(/^(\d+)x(\d+)$/);
    if (!match) return {};
    return { width: Number(match[1]), height: Number(match[2]) };
}

export async function generateImageWithSiliconFlow(input: {
    prompt: string;
    model?: string;
    imageSize?: string;
    numInferenceSteps?: number;
}): Promise<SiliconFlowImageGenerationResult> {
    if (!env.SILICONFLOW_API_KEY?.trim()) {
        throw Object.assign(new Error("SiliconFlow API key not configured"), { statusCode: 503 });
    }

    const model = input.model?.trim() || env.SILICONFLOW_IMAGE_MODEL;
    const imageSize = input.imageSize?.trim() || env.SILICONFLOW_IMAGE_SIZE;
    const numInferenceSteps = input.numInferenceSteps ?? env.SILICONFLOW_IMAGE_STEPS;
    const requestedAt = new Date();
    const t0 = Date.now();

    const response = await fetch(`${env.SILICONFLOW_BASE_URL.replace(/\/$/, "")}/images/generations`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.SILICONFLOW_API_KEY.trim()}`,
        },
        body: JSON.stringify({
            model,
            prompt: input.prompt,
            n: 1,
            image_size: imageSize,
            num_inference_steps: numInferenceSteps,
        }),
    });

    const completedAt = new Date();
    const latencyMs = Date.now() - t0;
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok) {
        throw Object.assign(new Error(`SiliconFlow image generation failed (${response.status})`), {
            statusCode: response.status,
            details: body,
        });
    }

    const first = Array.isArray(body["data"])
        ? (body["data"] as Array<Record<string, unknown>>)[0]
        : undefined;

    let buffer: Buffer | null = null;
    let outputMimeType = "image/png";
    let sourceUrl: string | undefined;

    if (typeof first?.["b64_json"] === "string" && first["b64_json"]) {
        buffer = Buffer.from(String(first["b64_json"]), "base64");
    } else if (typeof first?.["url"] === "string" && first["url"]) {
        sourceUrl = String(first["url"]);
        const imageResponse = await fetch(sourceUrl);
        if (!imageResponse.ok) {
            throw Object.assign(new Error(`Unable to fetch generated image bytes (${imageResponse.status})`), {
                statusCode: imageResponse.status,
            });
        }
        outputMimeType = inferMimeType(sourceUrl, imageResponse.headers.get("content-type"));
        buffer = Buffer.from(await imageResponse.arrayBuffer());
    }

    if (!buffer) {
        throw Object.assign(new Error("SiliconFlow returned no usable image payload"), { statusCode: 502, details: body });
    }

    const usage = parseTokenUsage(body["usage"]);
    const price = getSiliconFlowPrice(model);
    const providerCostUsd = price?.priceUnit === "per_image" ? price.input : undefined;
    const size = parseImageSize(imageSize);

    return {
        provider: "siliconflow",
        model,
        imageSize,
        numInferenceSteps,
        requestedAt,
        completedAt,
        latencyMs,
        providerRequestId: typeof body["id"] === "string" ? body["id"] : undefined,
        revisedPrompt: typeof first?.["revised_prompt"] === "string" ? String(first["revised_prompt"]) : undefined,
        finishReason: "completed",
        sourceUrl,
        outputMimeType,
        width: typeof first?.["width"] === "number" ? Number(first["width"]) : size.width,
        height: typeof first?.["height"] === "number" ? Number(first["height"]) : size.height,
        providerCostUsd,
        tokenUsage: usage,
        providerResponse: sanitizeProviderResponse(body),
        buffer,
    };
}
