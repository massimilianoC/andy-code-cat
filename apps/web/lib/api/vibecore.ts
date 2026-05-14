import { call } from "./call";
import type { VibeClassifyResponse, AttachmentMeta } from "@andy-code-cat/contracts";

export interface VibeClassifyInput {
    prompt: string;
    attachmentMeta?: AttachmentMeta[];
}

export function classifyVibeIntent(
    token: string,
    input: VibeClassifyInput,
): Promise<VibeClassifyResponse> {
    return call<VibeClassifyResponse>("POST", "/v1/vibecore/classify", input, {
        Authorization: `Bearer ${token}`,
    });
}
