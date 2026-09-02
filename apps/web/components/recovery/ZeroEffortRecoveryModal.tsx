"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProviderModelPicker, type PickerProvider } from "@/components/llm/ProviderModelPicker";
import type { ZeroEffortRecoveryStatus } from "@andy-code-cat/contracts";

/**
 * Offered when a Zero Effort generation breaks (docs/specs/INTERRUPTED_RUN_RECOVERY.md).
 *
 * The workspace already has recovery — a chat and a model picker, so typing "riprova" resumes with
 * history. Zero Effort has neither: one generation, and when it fails the only path today is to
 * start over having paid for whatever the model already produced. This is that missing offer, and
 * it exists on this path only.
 *
 * It states what is actually recoverable rather than promising vaguely. `tokensUsed` comes from the
 * failed journal row, so "N tokens already spent" is a fact the user can check, not reassurance.
 *
 * The parent decides whether to render it at all: the server answers `recoverable`, and a failure
 * that produced nothing — an HTTP 402, an invalid key — must not be offered a resumption from
 * nothing. See §4 of the spec.
 */

export interface ZeroEffortRecoveryModalProps {
    status: ZeroEffortRecoveryStatus;
    /** Populates the picker; pass the project's active catalog. Empty disables model switching. */
    providers: PickerProvider[];
    busy?: boolean;
    /** Resume with the chosen model — or the one that failed, when the user does not change it. */
    onRetry: (choice: { provider?: string; model?: string }) => void;
    /** Delete the project and everything the failed attempt left behind. */
    onDiscard: () => void;
    onClose: () => void;
}

export function ZeroEffortRecoveryModal({
    status,
    providers,
    busy = false,
    onRetry,
    onDiscard,
    onClose,
}: ZeroEffortRecoveryModalProps) {
    const { t } = useTranslation();
    const [provider, setProvider] = useState<string | undefined>(status.provider);
    const [model, setModel] = useState<string | undefined>(status.model);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);

    // Escape closes, which is the same as "not now" — the project stays, the offer can be taken
    // later. Only the explicit discard destroys anything.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const changedModel = provider !== status.provider || model !== status.model;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
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
                            {t("recovery.pickModelHint", "Un modello più veloce può finire il lavoro che il primo ha lasciato a metà.")}
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
                                "Rimuove il progetto, la sua cronologia dei prompt, i costi registrati e la sessione di lavoro. Non è reversibile.")}
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
                                {t("common.cancel", "Annulla")}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 flex flex-wrap items-center gap-2">
                        {/* Retry is the primary action: the work exists, and resuming is what the
                            user came here to be offered. */}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onRetry({ provider, model })}
                            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                            {busy
                                ? t("recovery.retrying", "Riprendo…")
                                : changedModel
                                    ? t("recovery.retryOther", "Riprendi con questo modello")
                                    : t("recovery.retrySame", "Riprendi")}
                        </button>
                        <button
                            type="button"
                            disabled={busy}
                            onClick={onClose}
                            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
                        >
                            {t("recovery.later", "Più tardi")}
                        </button>
                        {/* Destructive, so it is neither primary nor adjacent to the primary. */}
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setConfirmingDiscard(true)}
                            className="ml-auto text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
                        >
                            {t("recovery.discard", "Elimina il progetto")}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
