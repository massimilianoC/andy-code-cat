import { call } from "./call";
import type { VibeClassifyResponse, AttachmentMeta, VibePrefillRequest, VibePrefillResponse } from "@andy-code-cat/contracts";

export interface VibeClassifyInput {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
    provider?: string;
    model?: string;
}

export function classifyVibeIntent(
    token: string,
    input: VibeClassifyInput,
): Promise<VibeClassifyResponse> {
    return call<VibeClassifyResponse>("POST", "/v1/vibecore/classify", input, {
        Authorization: `Bearer ${token}`,
    });
}

export function prefillZeroEffort(
    token: string,
    input: VibePrefillRequest,
): Promise<VibePrefillResponse> {
    return call<VibePrefillResponse>("POST", "/v1/vibecore/prefill", input, {
        Authorization: `Bearer ${token}`,
    });
}

