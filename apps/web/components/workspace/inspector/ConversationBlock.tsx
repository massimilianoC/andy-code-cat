"use client";

import type { CSSProperties } from "react";
import PromptTranscriptView, { type PromptTranscriptMessage } from "@/components/PromptTranscriptView";
import { PfLayerAccordion } from "./PfLayerAccordion";

interface ConversationBlockProps {
    /** Every non-system message actually sent on the most recent turn, user and assistant alike. */
    messages: PromptTranscriptMessage[];
    /**
     * The system prompt of the CURRENT turn, which is not the generation's. After a few chat turns
     * the two diverge, and this is the only place the later one is visible.
     */
    currentTurnSystemPrompt?: string;
    labels: { user: string; assistant: string; system: string };
    layersTitle: string;
    transcriptTitle: string;
    emptyLabel: string;
}

const SECTION_LABEL: CSSProperties = {
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.35rem",
};

/**
 * Conversation block — the fourth block of the Prompt view.
 *
 * SESSION_INSPECTOR_SPEC.md §1 said the existing Prompt view "becomes" a history of how the
 * artifact came to exist, in three collapsible blocks. The old flat section it was meant to replace
 * was left standing beside it instead, so the view showed two stacks of prompt layers: the
 * generation's, inside Generation, and the current turn's, loose at the bottom. They look like a
 * duplicate and are not one — after a few chat turns the current turn's system prompt is no longer
 * the generation's.
 *
 * So the section is absorbed rather than deleted. The conversation is the content, and the layers
 * that wrapped it are a collapsed accordion above it: still reachable, because Rule Zero exists to
 * make exactly what was sent to the model knowable, and deleting them would have made that
 * unknowable for every turn after the first. Collapsed by default, because the question this block
 * answers is "what was said", and the question the layers answer is asked less often.
 */
export function ConversationBlock({
    messages,
    currentTurnSystemPrompt,
    labels,
    layersTitle,
    transcriptTitle,
    emptyLabel,
}: ConversationBlockProps) {
    const hasMessages = messages.length > 0;

    if (!hasMessages && !currentTurnSystemPrompt) {
        return <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{emptyLabel}</p>;
    }

    return (
        <div>
            {currentTurnSystemPrompt ? (
                <div style={{ marginBottom: hasMessages ? "0.9rem" : 0 }}>
                    <div style={SECTION_LABEL}>{layersTitle}</div>
                    <PfLayerAccordion fullText={currentTurnSystemPrompt} />
                </div>
            ) : null}

            {hasMessages ? (
                <>
                    <div style={SECTION_LABEL}>{transcriptTitle}</div>
                    <PromptTranscriptView messages={messages} labels={labels} />
                </>
            ) : null}
        </div>
    );
}
