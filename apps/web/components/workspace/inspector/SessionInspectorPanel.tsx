"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkSessionDetailDto, WorkSessionSummaryDto } from "@andy-code-cat/contracts";
import { listWorkSessions, getWorkSessionDetail } from "@/lib/api/workSessions";
import { formatCostEur, formatDuration } from "@/app/workspace/features/chat/messageUtils";
import { InspectorBlock } from "./InspectorBlock";
import { VibeBlock } from "./VibeBlock";
import { ZeroEffortBlock } from "./ZeroEffortBlock";
import { GenerationBlock } from "./GenerationBlock";
import { pickLatestSession, latestLogForStage, costForLog, canonicalBriefOf, blocksPresent, shouldFetchSessionDetail } from "./sessionSelectors";

interface SessionInspectorPanelProps {
    projectId: string;
}

type BlockKey = "vibe" | "zeroEffort" | "generation";

/**
 * The Prompt view's Session Inspector (docs/specs/SESSION_INSPECTOR_SPEC.md).
 *
 * Renders the most recent work session as up to three collapsible blocks — Vibe, Zero Effort,
 * Generation — in that order, with Generation open by default. A block renders only when the
 * session actually produced it (spec §5.1); nothing is shown for a session with no activity
 * recorded yet.
 *
 * Fetch discipline (spec §5.5, §6.8): mounting this component calls only the list endpoint, which
 * carries no prompt bodies. The one detail fetch (the only endpoint that has bodies) happens the
 * first time any block's open state becomes true — Generation starts open, so that fetch happens
 * as part of mounting, and Vibe/Zero Effort reuse the same already-fetched detail without any
 * further request when the user opens them.
 */
export function SessionInspectorPanel({ projectId }: SessionInspectorPanelProps) {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<WorkSessionSummaryDto[] | null>(null);
    const [sessionsError, setSessionsError] = useState<string | null>(null);

    const [detail, setDetail] = useState<WorkSessionDetailDto | null>(null);
    const [detailFetchedFor, setDetailFetchedFor] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const [open, setOpen] = useState<Record<BlockKey, boolean>>({ vibe: false, zeroEffort: false, generation: true });

    // Step 1: the list only — no prompt bodies anywhere in this response.
    useEffect(() => {
        let cancelled = false;
        setSessions(null);
        setSessionsError(null);
        listWorkSessions(projectId)
            .then((res) => {
                if (!cancelled) setSessions(res);
            })
            .catch((err) => {
                if (!cancelled) setSessionsError(err instanceof Error ? err.message : String(err));
            });
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    const latestSession = sessions ? pickLatestSession(sessions) : undefined;
    const anyBlockOpen = open.vibe || open.zeroEffort || open.generation;

    // Step 2: the one detail fetch, gated on a block actually being open (spec §5.5). Generation
    // starts open, so this fires right after the session id is known — that IS "expanding a
    // block", just the one that starts pre-expanded.
    // The in-flight guard is a ref, not state, and `detailLoading` is deliberately NOT a dependency.
    //
    // It used to be both: the effect called setDetailLoading(true), which changed a value it
    // depended on, so React re-ran it — and the cleanup of the first pass set `cancelled = true`.
    // The request itself completed (the server answered 200 with the whole detail), but `.then`
    // and `.finally` are both guarded by `cancelled`, so the result was discarded and
    // `detailLoading` was never set back to false. The panel showed "Caricamento cronologia…"
    // forever, on every project, while the network tab showed one successful response.
    const inFlightFor = useRef<string | null>(null);

    useEffect(() => {
        const sessionId = latestSession?.id;
        if (!shouldFetchSessionDetail({
            sessionId,
            anyBlockOpen,
            fetchedFor: detailFetchedFor,
            inFlightFor: inFlightFor.current,
        })) return;

        let cancelled = false;
        inFlightFor.current = sessionId!;
        setDetailLoading(true);
        setDetailError(null);
        getWorkSessionDetail(projectId, sessionId!)
            .then((res) => {
                if (cancelled) return;
                setDetail(res);
                setDetailFetchedFor(sessionId!);
            })
            .catch((err) => {
                if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                // Cleared whether or not this pass was cancelled: leaving the flag set would block
                // every later attempt, which is the failure this replaced.
                if (inFlightFor.current === sessionId) inFlightFor.current = null;
                if (!cancelled) setDetailLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, latestSession, anyBlockOpen, detailFetchedFor]);

    function toggle(block: BlockKey) {
        setOpen((prev) => ({ ...prev, [block]: !prev[block] }));
    }

    if (sessionsError) {
        return <p style={{ color: "#f87171", fontSize: "0.8rem" }}>{sessionsError}</p>;
    }
    if (sessions === null) {
        return <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{t("workspace.inspector.loading", "Caricamento cronologia…")}</p>;
    }
    if (!latestSession) {
        return <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{t("workspace.inspector.empty", "Nessuna attività registrata per questo progetto.")}</p>;
    }

    const isDetailForLatest = detail && detailFetchedFor === latestSession.id;
    const presence = isDetailForLatest ? blocksPresent(detail) : null;

    const classifyLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "vibe_classify") : undefined;
    const prefillLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "vibe_prefill") : undefined;
    const generateLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "generate") : undefined;
    const canonicalBrief = isDetailForLatest ? canonicalBriefOf(detail) : undefined;
    const zeroEffortProposal = isDetailForLatest ? detail.zeroEffortFormProposals[0] : undefined;
    const vibeIntake = isDetailForLatest ? detail.vibeIntakes[0] : undefined;

    return (
        <div>
            {presence?.vibe && vibeIntake && (
                <InspectorBlock
                    title={t("workspace.inspector.vibeTitle", "Vibe")}
                    subtitle={formatCostEur(costForLog(detail!.costTransactions, classifyLog?.id)) || undefined}
                    open={open.vibe}
                    onToggle={() => toggle("vibe")}
                >
                    <VibeBlock intake={vibeIntake} classifyLog={classifyLog} costEur={costForLog(detail!.costTransactions, classifyLog?.id)} />
                </InspectorBlock>
            )}

            {presence?.zeroEffort && (
                <InspectorBlock
                    title={t("workspace.inspector.zeroEffortTitle", "Zero Effort")}
                    subtitle={formatCostEur(costForLog(detail!.costTransactions, prefillLog?.id)) || undefined}
                    open={open.zeroEffort}
                    onToggle={() => toggle("zeroEffort")}
                >
                    <ZeroEffortBlock
                        sourceFields={canonicalBrief?.sourceFields ?? {}}
                        proposal={zeroEffortProposal}
                        canonicalBrief={canonicalBrief}
                    />
                </InspectorBlock>
            )}

            {/* Generation: open by default (spec §1) and its truncation badge must be visible in
                the collapsed row (spec §3, §6.6) — summary.truncated answers that with no fetch. */}
            {(presence === null || presence.generation) && (
                <InspectorBlock
                    title={t("workspace.inspector.generationTitle", "Generation")}
                    subtitle={
                        generateLog
                            ? [formatCostEur(costForLog(detail!.costTransactions, generateLog.id)) || undefined, formatDuration(generateLog.durationMs)]
                                  .filter(Boolean)
                                  .join(" · ")
                            : undefined
                    }
                    badge={latestSession.truncated ? { label: t("workspace.inspector.truncated", "TRONCATO"), tone: "warning" } : undefined}
                    open={open.generation}
                    onToggle={() => toggle("generation")}
                >
                    {detailLoading && !generateLog && (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{t("workspace.inspector.loading", "Caricamento cronologia…")}</p>
                    )}
                    {detailError && <p style={{ color: "#f87171", fontSize: "0.8rem" }}>{detailError}</p>}
                    {generateLog && <GenerationBlock log={generateLog} costEur={costForLog(detail!.costTransactions, generateLog.id)} />}
                    {isDetailForLatest && !generateLog && (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                            {t("workspace.inspector.noGeneration", "Questa sessione non ha ancora una generazione.")}
                        </p>
                    )}
                </InspectorBlock>
            )}

            {isDetailForLatest && !presence?.vibe && !presence?.zeroEffort && !presence?.generation && (
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {t("workspace.inspector.noActivity", "Questa sessione non ha ancora nulla da mostrare.")}
                </p>
            )}
        </div>
    );
}
