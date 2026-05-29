type ChatCompletionMessage = {
    role: string;
    content: string | Array<unknown>;
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

export function buildChatCompletionRequestBody(input: {
    provider: string;
    model: string;
    messages: ChatCompletionMessage[];
    maxTokens: number;
    temperature: number;
    stream?: boolean;
    thinkingBudget?: number;
}) {
    const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        ...(input.stream ? { stream: true } : {}),
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
