"use client";

import type { CSSProperties } from "react";
import type { PromptExecutionLogDetailDto } from "@andy-code-cat/contracts";
import { PfLayerAccordion } from "./PfLayerAccordion";
import { RawTextBlock } from "./RawTextBlock";
import { JournalMeta } from "./JournalMeta";

interface GenerationBlockProps {
    log: PromptExecutionLogDetailDto;
    costEur: number;
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
 * Generation block (SESSION_INSPECTOR_SPEC.md §3): the layered system prompt split by its
 * PF_LAYER markers, then the raw reply before parsing, finishReason, endpoint, tokens, cost.
 *
 * No artifact preview here: WorkSessionDetailDto has no snapshot reference (that lives on
 * preview_snapshots, which this endpoint does not return — see the report for this gap). The
 * generated artifact for this exact run is what the workspace canvas next to this panel already
 * shows; duplicating it here would require a field the DTO doesn't have.
 */
export function GenerationBlock({ log, costEur }: GenerationBlockProps) {
    return (
        <div>
            {log.renderedSystemPrompt ? (
                <>
                    <div style={SECTION_LABEL}>System prompt, by layer</div>
                    <PfLayerAccordion fullText={log.renderedSystemPrompt} />
                </>
            ) : null}

            {log.renderedUserPrompt && <RawTextBlock label="User prompt sent" text={log.renderedUserPrompt} />}

            {log.rawResponse && (
                <>
                    <div style={{ ...SECTION_LABEL, marginTop: "0.75rem" }}>Raw reply</div>
                    <RawTextBlock label="Raw reply (before parsing)" text={log.rawResponse} meta={log.finishReason} />
                </>
            )}

            {log.contextAssetIds && log.contextAssetIds.length > 0 && (
                <div style={{ fontSize: "0.74rem", color: "#6b7280", marginTop: "0.5rem" }}>
                    <span style={{ color: "#4b5563", marginRight: "0.3rem" }}>Context assets</span>
                    {log.contextAssetIds.join(", ")}
                </div>
            )}

            <JournalMeta
                endpoint={log.endpoint}
                provider={log.provider}
                model={log.model}
                finishReason={log.finishReason}
                usage={log.usage}
                durationMs={log.durationMs}
                costEur={costEur}
            />
        </div>
    );
}
