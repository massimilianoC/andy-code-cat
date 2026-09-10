"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderModelPicker, type PickerProvider } from "@/components/llm/ProviderModelPicker";
import type { ZeroEffortRecoveryStatus } from "@andy-code-cat/contracts";

/**
 * Offered when the Vibe → prefill call breaks (docs/specs/INTERRUPTED_RUN_RECOVERY.md §3).
 *
 * **This modal is a transition, not a menu.** It exists on the Vibe path only, because there the
 * user is not yet in the workspace and has no model picker in front of them, so one dialog has to do
 * both jobs: decide how to continue, and carry them to where continuing is possible. Resuming
 * navigates to the workspace with the whole recovered context — the original prompt, the brief, the
 * attachments and the interrupted thinking — already assembled by the server as `resumePrompt`.
 *
 * The workspace does NOT use this. There the user is already at the destination with a chat and a
 * picker, so the failure surfaces as an error and a retry; rendering this modal there would offer a
 * second copy of controls already on screen.
 *
 * It states what is actually recoverable rather than promising vaguely: `tokensUsed` comes from the
 * failed journal row, so "N tokens already spent" is a fact the user can check.
 *
 * The parent decides whether to render it at all. The server answers `recoverable`, and a failure
 * that produced nothing — an HTTP 402, an invalid key — must not be offered a resumption from
 * nothing (§4).
 */

export interface ZeroEffortRecoveryModalProps {
    status: ZeroEffortRecoveryStatus;
    /** Populates the picker; pass the project's active catalog. Empty disables model switching. */
    providers: PickerProvider[];
    busy?: boolean;
    /** Resume with the chosen model — or the one that failed, when the user does not change it. */
    onRetry: (choice: { provider?: string; model?: string }) => void;
    /**
     * Delete the project and everything the failed attempt left behind.
     *
     * This is what "cancel" means here. There is no dismissal that leaves the project in place: an
     * unresumed failure is exactly the ghost entry that makes a dashboard a list of things the user
     * does not have.
     */
    onDiscard: () => void;
}

export function ZeroEffortRecoveryModal({
    status,
    providers,
    busy = false,
    onRetry,
    onDiscard,
}: ZeroEffortRecoveryModalProps) {
    const { t } = useTranslation();
    const [provider, setProvider] = useState<string | undefined>(status.provider);
    const [model, setModel] = useState<string | undefined>(status.model);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);

    // Escape and the backdrop deliberately do NOT dismiss. There is no longer a "later": the only
    // ways out are resuming and deleting, and deleting on a stray keypress would destroy a project
    // the user never chose to destroy. A forced choice is the honest shape when both exits act.
    useEffect(() => {
        const swallowEscape = (e: KeyboardEvent) => { if (e.key === "Escape") e.stopPropagation(); };
        window.addEventListener("keydown", swallowEscape, true);
        return () => window.removeEventListener("keydown", swallowEscape, true);
    }, []);

    const changedModel = provider !== status.provider || model !== status.model;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
            <div className="w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-xl">
                <h2 id="recovery-title" className="text-lg font-semibold">
                    {t("recovery.title", "La generazione si è interrotta")}
                </h2>

                {/* The point of the whole feature: say what exists, with a number that came from the
                    journal rather than from optimism. */}
                <p className="mt-2 text-sm text-muted-foreground">
                    {t("recovery.body", "Ci sono {{tokens}} token di lavoro già fatto — una risposta parziale e il ragionamento del modello. Puoi riprendere da lì invece di ricominciare.", { tokens: (status.tokensUsed ?? 0).toLocaleString() })}
                </p>

                <dl className="mt-4 space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between gap-4">
                        <dt>{t("recovery.failedModel", "Modello che si è fermato")}</dt>
                        <dd className="font-mono">{status.provider}/{status.model}</dd>
                    </div>
                    {status.hasReasoningTrace && (
                        <div className="flex justify-between gap-4">
                            <dt>{t("recovery.reasoningKept", "Ragionamento conservato")}</dt>
                            <dd>✓</dd>
                        </div>
                    )}
                    {status.hasRawResponse && (
                        <div className="flex justify-between gap-4">
                            <dt>{t("recovery.partialKept", "Risposta parziale conservata")}</dt>
                            <dd>✓</dd>
                        </div>
                    )}
                </dl>

                {providers.length > 0 && (
                    <div className="mt-5">
                        <label className="mb-1 block text-xs font-medium">
                            {t("recovery.pickModel", "Riprova con un altro modello")}
                        </label>
                        {/* The existing picker, not a new one — the same component the dashboard and
                            the workspace use, so the catalog rules and the availability filtering
                            stay in one place. */}
                        <ProviderModelPicker
                            providers={providers}
                            valueProvider={provider}
                            valueModel={model}
                            onChange={(next) => { setProvider(next.provider); setModel(next.model); }}
                            preferredCapability="chat"
                            disabled={busy}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t("recovery.pickModelHint", "Un modello più veloce può finire il lavoro che il primo ha lasciato a metà. Il prompt, il brief, gli allegati e il ragionamento interrotto vengono portati con te.")}
                        </p>
                    </div>
                )}

                {confirmingDiscard ? (
                    /* Two steps, because this deletes more than the user is looking at. Saying what
                       goes is the difference between a choice and a surprise. */
                    <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                        <p className="text-sm font-medium">
                            {t("recovery.discardConfirmTitle", "Eliminare il progetto?")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t("recovery.discardConfirmBody",
                                "Rimuove il progetto, la sua cronologia dei prompt, i costi registrati e la sessione di lavoro. Non è reversibile. Il lavoro già pagato che stavi per riprendere va perso con lui.")}
                        </p>
                        <div className="mt-3 flex gap-2">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={onDiscard}
                                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
                            >
                                {t("recovery.discardConfirm", "Sì, elimina")}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirmingDiscard(false)}
                                className="rounded-md border border-border px-3 py-1.5 text-xs disabled:opacity-50"
                            >
                                {t("recovery.backToChoice", "Torna indietro")}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 flex flex-wrap items-center gap-2">
                        {/* Two ways out and no third. Leaving the project behind unresumed is what
                            fills the dashboard with entries that are not things the user has, so
                            "cancel" here means "delete", stated plainly rather than implied. */}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onRetry({ provider, model })}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                            {busy
                                ? t("recovery.retrying", "Riprendo…")
                                : changedModel
                                    ? t("recovery.resumeOther", "Riprendi in project mode con questo modello")
                                    : t("recovery.resume", "Riprendi in project mode")}
                        </button>
                        {/* Destructive, so it is not adjacent to the primary and it says what it
                            does. It still goes through the confirmation below, which names what is
                            removed — a project that is deleted the moment you decline is a surprise,
                            not a choice. */}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmingDiscard(true)}
                            className="ml-auto rounded-md border border-border px-4 py-2 text-sm text-muted-foreground disabled:opacity-50"
                        >
                            {t("recovery.cancelAndDelete", "Annulla ed elimina il progetto")}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
