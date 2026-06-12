import { call, ApiError } from "./call";
import { getAccessToken, isAccessTokenExpired } from "../token-store";
import { getSharedRefreshPromise, setSharedRefreshPromise, refreshAccessToken } from "./call";
import type {
    DidacticKnowledgeStatusDto,
    DidacticKnowledgeResponseDto,
    DidacticQnaEntry,
    GenerateDidacticKnowledgeInput,
    AskDidacticQuestionInput,
} from "@andy-code-cat/contracts";

export type DidacticStreamEvent =
    | { type: "token"; content: string }
    | { type: "answer"; content: string }
    | { type: "done" }
    | { type: "error"; message: string; durationMs?: number };

export function getDidacticKnowledge(token: string, projectId: string, snapshotId: string) {
    return call<DidacticKnowledgeStatusDto>("GET", `/v1/projects/${projectId}/didactic/knowledge?snapshotId=${encodeURIComponent(snapshotId)}`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export function generateDidacticKnowledge(
    token: string,
    projectId: string,
    input: GenerateDidacticKnowledgeInput
) {
    return call<DidacticKnowledgeResponseDto>("POST", `/v1/projects/${projectId}/didactic/knowledge/generate`, input, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}

export async function streamDidacticAsk(
    token: string,
    projectId: string,
    input: AskDidacticQuestionInput,
    onEvent: (event: DidacticStreamEvent) => void,
    signal?: AbortSignal
) {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

    let effectiveToken = getAccessToken() ?? token;
    if (isAccessTokenExpired()) {
        try {
            if (!getSharedRefreshPromise()) {
                setSharedRefreshPromise(refreshAccessToken());
            }
            effectiveToken = await getSharedRefreshPromise()!;
            setSharedRefreshPromise(null);
        } catch {
            setSharedRefreshPromise(null);
            throw new ApiError(401, { error: "Sessione scaduta" });
        }
    }

    const res = await fetch(`${baseUrl}/v1/projects/${projectId}/didactic/ask/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${effectiveToken}`,
            "x-project-id": projectId,
        },
        body: JSON.stringify(input),
        signal,
    });

    if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, text || { error: "Didactic stream unavailable" });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
                const event = JSON.parse(payload) as DidacticStreamEvent;
                onEvent(event);
            } catch {
                continue;
            }
        }
    }
}

export function listDidacticQna(token: string, projectId: string) {
    return call<{ entries: DidacticQnaEntry[] }>("GET", `/v1/projects/${projectId}/didactic/qna`, undefined, {
        Authorization: `Bearer ${token}`,
        "x-project-id": projectId,
    });
}
