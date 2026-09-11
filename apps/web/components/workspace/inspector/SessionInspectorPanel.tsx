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
import { ConversationBlock } from "./ConversationBlock";
import type { PromptTranscriptMessage } from "@/components/PromptTranscriptView";
import { pickLatestSession, latestLogForStage, costForLog, canonicalBriefOf, blocksPresent, shouldFetchSessionDetail, detailRequestKey } from "./sessionSelectors";

interface SessionInspectorPanelProps {
    projectId: string;
    /**
     * The most recent turn actually sent, owned by the workspace page rather than the journal.
     * Rendered as the fourth block so the Prompt view is one ordered history instead of the
     * inspector plus a loose section beneath it (SESSION_INSPECTOR_SPEC.md §1).
     */
    conversation?: {
        messages: PromptTranscriptMessage[];
        currentTurnSystemPrompt?: string;
    };
    /**
     * Changes whenever a turn completes. The panel re-reads the journal when it does.
     *
     * Without it the list was read once, at mount. That held in the Vibe flow, where the session
     * exists before the workspace opens, and failed in Project Mode, where the session is opened
     * BY the first generation — after the panel had already mounted and found nothing.
     */
    refreshToken?: number;
}

type BlockKey = "vibe" | "zeroEffort" | "generation" | "conversation";

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
export function SessionInspectorPanel({ projectId, conversation, refreshToken = 0 }: SessionInspectorPanelProps) {
    const { t } = useTranslation();
    const [sessions, setSessions] = useState<WorkSessionSummaryDto[] | null>(null);
    const [sessionsError, setSessionsError] = useState<string | null>(null);

    const [detail, setDetail] = useState<WorkSessionDetailDto | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const [open, setOpen] = useState<Record<BlockKey, boolean>>({ vibe: false, zeroEffort: false, generation: true, conversation: false });

    // The user's own "reload" — the same re-read a completed turn triggers.
    const [manualReload, setManualReload] = useState(0);
    const [reloading, setReloading] = useState(false);
    // How many times the list has been read. Part of the detail's request key, so every re-read of
    // the list is followed by a fresh read of the detail (see detailRequestKey).
    const [listRead, setListRead] = useState(0);

    // A different project is a different history: start from nothing so the previous one's
    // blocks never render under the new project's name.
    useEffect(() => {
        setSessions(null);
        setDetail(null);
    }, [projectId]);

    // Step 1: the list only — no prompt bodies anywhere in this response. Re-run on a completed
    // turn and on the reload button; a re-read keeps what is on screen until the answer arrives.
    useEffect(() => {
        let cancelled = false;
        setSessionsError(null);
        setReloading(true);
        listWorkSessions(projectId)
            .then((res) => {
                if (cancelled) return;
                setSessions(res);
                setListRead((n) => n + 1);
            })
            .catch((err) => {
                if (!cancelled) setSessionsError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setReloading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, refreshToken, manualReload]);

    const latestSession = sessions ? pickLatestSession(sessions) : undefined;
    const latestSessionId = latestSession?.id;
    // Conversation is deliberately excluded: it renders from props the page already holds, so
    // opening it must not be what triggers the session detail fetch.
    const anyBlockOpen = open.vibe || open.zeroEffort || open.generation;
    const requestKey = detailRequestKey(latestSessionId, listRead);

    // Step 2: the detail read, gated on a block actually being open (spec §5.5). Generation starts
    // open, so this fires right after the list — that IS "expanding a block", just the one that
    // starts pre-expanded.
    //
    // Nothing here is cancelled on re-run: a superseded response is discarded by sequence number
    // instead. Both earlier versions cancelled in the effect cleanup and then relied on the request
    // they had cancelled, and both hung on "Caricamento cronologia…" (see shouldFetchSessionDetail).
    const startedFor = useRef<string | null>(null);
    const requestSeq = useRef(0);

    useEffect(() => {
        if (!shouldFetchSessionDetail({ requestKey, anyBlockOpen, startedFor: startedFor.current })) return;
        startedFor.current = requestKey;
        const seq = ++requestSeq.current;
        setDetailLoading(true);
        setDetailError(null);
        getWorkSessionDetail(projectId, latestSessionId!)
            .then((res) => {
                if (seq === requestSeq.current) setDetail(res);
            })
            .catch((err) => {
                if (seq === requestSeq.current) setDetailError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (seq === requestSeq.current) setDetailLoading(false);
            });
    }, [projectId, latestSessionId, anyBlockOpen, requestKey]);

    function toggle(block: BlockKey) {
        setOpen((prev) => ({ ...prev, [block]: !prev[block] }));
    }

    // Always on screen, including when there is nothing yet: "nothing recorded" was a dead end the
    // user could not get out of without reloading the whole workspace.
    const reloadBar = (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "0.5rem" }}>
            <button
                type="button"
                className="secondary"
                onClick={() => setManualReload((n) => n + 1)}
                disabled={reloading || detailLoading}
                title={t("workspace.inspector.reloadTitle", "Rileggi dal journal le sessioni e i prompt inviati")}
                style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }}
            >
                {reloading || detailLoading
                    ? t("workspace.inspector.reloading", "Aggiornamento…")
                    : t("workspace.inspector.reload", "↻ Aggiorna")}
            </button>
        </div>
    );

    if (sessionsError) {
        return <div>{reloadBar}<p style={{ color: "#f87171", fontSize: "0.8rem" }}>{sessionsError}</p></div>;
    }
    if (sessions === null) {
        return <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{t("workspace.inspector.loading", "Caricamento cronologia…")}</p>;
    }
    if (!latestSession) {
        return (
            <div>
                {reloadBar}
                <p style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{t("workspace.inspector.empty", "Nessuna attività registrata per questo progetto.")}</p>
            </div>
        );
    }

    // Matched on the id the detail itself carries: while a re-read is in flight the previous
    // detail of the same session stays on screen instead of blinking out.
    const isDetailForLatest = detail !== null && detail.id === latestSession.id;
    const presence = isDetailForLatest ? blocksPresent(detail) : null;

    const classifyLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "vibe_classify") : undefined;
    const prefillLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "vibe_prefill") : undefined;
    const generateLog = isDetailForLatest ? latestLogForStage(detail.promptExecutionLogs, "generate") : undefined;
    const canonicalBrief = isDetailForLatest ? canonicalBriefOf(detail) : undefined;
    const zeroEffortProposal = isDetailForLatest ? detail.zeroEffortFormProposals[0] : undefined;
    const vibeIntake = isDetailForLatest ? detail.vibeIntakes[0] : undefined;

    return (
        <div>
            {reloadBar}
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

            {(conversation?.messages.length || conversation?.currentTurnSystemPrompt) && (
                <InspectorBlock
                    title={t("workspace.inspector.conversationTitle", "Cronologia inviata")}
                    subtitle={t("workspace.inspector.conversationSubtitle", "I turni successivi alla generazione, come sono stati inviati")}
                    open={open.conversation}
                    onToggle={() => toggle("conversation")}
                >
                    <ConversationBlock
                        messages={conversation.messages}
                        currentTurnSystemPrompt={conversation.currentTurnSystemPrompt}
                        layersTitle={t("workspace.inspector.conversationLayers", "System prompt del turno corrente, per layer")}
                        transcriptTitle={t("workspace.inspector.conversationTranscript", "Messaggi inviati")}
                        emptyLabel={t("workspace.inspector.conversationEmpty", "Nessun turno inviato dopo la generazione.")}
                        labels={{
                            user: t("workspace.ui.promptPanelUserMessage", "Messaggio utente"),
                            assistant: t("workspace.ui.promptPanelAssistantMessage", "Messaggio assistant (cronologia)"),
                            system: "System",
                        }}
                    />
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
