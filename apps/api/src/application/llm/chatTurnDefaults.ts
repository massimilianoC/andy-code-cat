/**
 * The defaults of a chat turn in the workspace. Served to every client as
 * `prompt-config.chatDefaults` (clients must not hardcode them) and used as-is by the background
 * worker, so a turn sent by either carries the same capability, role and temperature.
 */
export const CHAT_TURN_DEFAULTS = {
    temperature: 0.4,
    pipelineRole: "dialogue",
    capability: "chat",
} as const;
