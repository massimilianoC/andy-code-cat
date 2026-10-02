/**
 * Completion budget for the first Zero Effort layer — the calls that turn a Vibe prompt and its
 * attachments into the pre-filled form (VibeClassify, VibePrefill).
 *
 * `max_tokens` is a ceiling, not a spend: a model without reasoning stops after the few hundred
 * (classify) or few thousand (prefill) tokens its JSON needs, whatever the ceiling. A reasoning
 * model spends the same allowance on its chain of thought before the first character of JSON,
 * and measured runs need 6-8k of thinking. Below that the call ends in finish_reason=length with
 * the thinking paid for and an empty or half-written answer — which is how this layer kept
 * stalling with thinking models.
 *
 * The floor applies over the operator setting, not under it: `promptTaskSettings` persisted by an
 * older release (256 for classify, 2048-16000 for prefill) override the code defaults, so a
 * default alone would never reach an installation that saved its settings once.
 *
 * 32k ceiling: the catalog does not record per-model output limits, and a max_tokens above what a
 * model accepts can be refused by the provider.
 */
export const ZERO_EFFORT_MIN_COMPLETION_TOKENS = 24_000;
export const ZERO_EFFORT_MAX_COMPLETION_TOKENS = 32_000;

export function zeroEffortCompletionBudget(configuredMaxCompletionTokens: number | undefined): number {
    const configured = Number.isFinite(configuredMaxCompletionTokens) ? Number(configuredMaxCompletionTokens) : 0;
    return Math.min(Math.max(configured, ZERO_EFFORT_MIN_COMPLETION_TOKENS), ZERO_EFFORT_MAX_COMPLETION_TOKENS);
}
