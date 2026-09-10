"use client";

import type { CSSProperties } from "react";
import type { CanonicalBriefEnvelope, ZeroEffortFormProposalDetailDto } from "@andy-code-cat/contracts";
import { RawTextBlock } from "./RawTextBlock";
import { formatFieldValue, humanizeFieldName } from "./formatters";

interface ZeroEffortBlockProps {
    /** The confirmed fields — owned by canonicalBrief.sourceFields (spec §5.2), not the proposal. */
    sourceFields: Record<string, unknown>;
    proposal?: ZeroEffortFormProposalDetailDto;
    canonicalBrief?: CanonicalBriefEnvelope;
}

const SECTION_LABEL: CSSProperties = {
    fontSize: "0.68rem",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "0.35rem",
};

const CELL: CSSProperties = { padding: "0.4rem 0.6rem", fontSize: "0.76rem", verticalAlign: "top" };

/**
 * Zero Effort block (SESSION_INSPECTOR_SPEC.md §3): the nineteen fields as submitted, beside what
 * the model proposed, with edited fields marked — the only place in the product that shows the
 * difference between the machine's suggestion and the human's decision. Then the brief, with its
 * contentHash visible as the certificate that this text is what was sent.
 */
export function ZeroEffortBlock({ sourceFields, proposal, canonicalBrief }: ZeroEffortBlockProps) {
    const editedFields = new Set(proposal?.editedFields ?? []);
    const prefilled = (proposal?.prefilled as Record<string, unknown> | undefined) ?? {};
    const fieldNames = Array.from(new Set([...Object.keys(sourceFields), ...Object.keys(prefilled)]));

    return (
        <div>
            {fieldNames.length > 0 && (
                <>
                    <div style={SECTION_LABEL}>Fields — as submitted vs. what the model proposed</div>
                    <div style={{ overflowX: "auto", marginBottom: "0.85rem" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid #1f2a3c" }}>
                                    <th style={{ ...CELL, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>Field</th>
                                    <th style={{ ...CELL, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>As submitted</th>
                                    <th style={{ ...CELL, textAlign: "left", color: "#6b7280", fontWeight: 600 }}>Model proposed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {fieldNames.map((field) => {
                                    const changed = editedFields.has(field);
                                    return (
                                        <tr key={field} style={{ borderBottom: "1px solid #141d2e" }}>
                                            <td style={{ ...CELL, color: "#94a3b8", whiteSpace: "nowrap" }}>{humanizeFieldName(field)}</td>
                                            <td style={{ ...CELL, color: changed ? "#34d399" : "#e2e8f0" }}>
                                                {formatFieldValue(sourceFields[field])}
                                                {changed && (
                                                    <span
                                                        style={{
                                                            marginLeft: "0.4rem",
                                                            fontSize: "0.62rem",
                                                            fontWeight: 700,
                                                            padding: "0.05rem 0.35rem",
                                                            borderRadius: "9999px",
                                                            background: "#34d39922",
                                                            color: "#34d399",
                                                            border: "1px solid #34d39955",
                                                        }}
                                                    >
                                                        CHANGED
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ ...CELL, color: "#6b7280" }}>{formatFieldValue(prefilled[field])}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {canonicalBrief && (
                <>
                    <div style={SECTION_LABEL}>Brief</div>
                    <div style={{ fontSize: "0.76rem", color: "#94a3b8", marginBottom: "0.4rem" }}>
                        <span style={{ color: "#4b5563", marginRight: "0.3rem" }}>contentHash</span>
                        <span style={{ fontFamily: "monospace", color: "#7dd3fc" }}>{canonicalBrief.contentHash}</span>
                    </div>
                    <RawTextBlock label="Brief text" text={canonicalBrief.content} meta={canonicalBrief.contentHash} />
                </>
            )}
        </div>
    );
}
