import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";

// WP1 step 1 regression test (docs/specs/SESSION_TRACING_EXECUTION_PLAN.md).
//
// The defect: `conversations[].metadata.generatedArtifacts` was read as a live fallback at
// page.tsx:1901 and :2146 because there was a window — most visibly a conversation's very
// first generation, before any PreviewSnapshot existed — where the assistant message already
// sat in `activeConv` state while the snapshot it produced was still being committed
// (commitArtifactVersion + listPreviewSnapshots, both awaited network calls). Any render in
// that window had a "latest assistant message" with no snapshot backing it, which is exactly
// the gap the generatedArtifacts fallback existed to paper over.
//
// The fix: handleSend no longer pushes the assistant message into activeConv immediately after
// addMessage() resolves. It waits until the snapshot commit (or the decision that this turn
// produces no snapshot) has already settled, then pushes the message — carrying its
// snapshotId, when there is one — through a single named gate, addAssistantMessageToConv.
//
// This can't be exercised as a rendered-component test: page.tsx is a "use client" page with
// heavy UI dependencies (grapesjs, monaco-editor, radix) and this workspace's vitest.config.ts
// runs the "node" environment with no React/JSX transform plugin configured — importing the
// module here fails at parse time, because tsconfig's jsx:"preserve" is meant for Next's own
// compiler, not Vite's esbuild (verified: `import { x } from "../page"` throws "Failed to parse
// source for import analysis... make sure to not set jsx to preserve"). Changing vitest.config
// or tsconfig to work around that is outside WP1's owned files. So this test reads the actual
// page.tsx source and asserts the ordering invariant directly on it, rather than mirroring the
// logic in a copy that could silently drift from the real implementation.
//
// Assertions are scoped to the handleSend function body specifically (not the whole file):
// an unrelated flow later in the file (the prompt-optimizer path, runOptimizeAsync) has its own
// local `assistantSaved`/`setActiveConv` that never produces an artifact or a snapshot, so a
// whole-file string search would false-positive against it.

const fullSource = readFileSync(
    path.join(__dirname, "..", "page.tsx"),
    "utf8"
);

const HANDLE_SEND_START = "async function handleSend(e: React.FormEvent) {";
const HANDLE_SEND_END = "async function runOptimizeAsync(original: string): Promise<string | null> {";

let handleSendSource: string;

beforeAll(() => {
    const startIdx = fullSource.indexOf(HANDLE_SEND_START);
    const endIdx = fullSource.indexOf(HANDLE_SEND_END);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        throw new Error(
            "could not isolate handleSend's body in page.tsx — its surrounding markers moved; " +
            "update HANDLE_SEND_START/HANDLE_SEND_END in this test to match."
        );
    }
    handleSendSource = fullSource.slice(startIdx, endIdx);
});

function indexOfOrThrow(needle: string, label: string): number {
    const idx = handleSendSource.indexOf(needle);
    if (idx === -1) {
        throw new Error(`expected to find ${label} inside handleSend: ${JSON.stringify(needle)}`);
    }
    return idx;
}

describe("WP1 step 1 — assistant message never precedes its snapshot in activeConv state", () => {
    it("gates every push to activeConv.messages (inside handleSend) through addAssistantMessageToConv", () => {
        // Pre-fix, handleSend pushed the raw message directly right after addMessage():
        //   messages: [...prev.messages, assistantSaved.message]
        // That literal pattern must not reappear inside handleSend — every push now goes
        // through the named helper below, whose reducer body is the only place messages are
        // appended.
        expect(handleSendSource).not.toContain("messages: [...prev.messages, assistantSaved.message]");

        const helperDefIdx = indexOfOrThrow(
            "const addAssistantMessageToConv = (message: MessageDto) => {",
            "the addAssistantMessageToConv helper definition"
        );
        const reducerBodyIdx = handleSendSource.indexOf("messages: [...prev.messages, message]");
        expect(reducerBodyIdx).toBeGreaterThan(helperDefIdx);
    });

    it("commits the PreviewSnapshot before the successful-turn message reaches state", () => {
        const assistantSavedIdx = indexOfOrThrow(
            "const assistantSaved = await addMessage(token, projectId, convId, {",
            "the assistantSaved addMessage call"
        );
        const commitIdx = indexOfOrThrow(
            "const snap = await commitArtifactVersion(token, {",
            "the snapshot commit call"
        );
        const successPushIdx = indexOfOrThrow(
            "addAssistantMessageToConv(buildAssistantMessageForConv(assistantSaved.message, snap.snapshot));",
            "the success-path push carrying the committed snapshot"
        );

        // The message is persisted server-side first; the snapshot commit and the state push
        // both come after, and the push comes strictly after the commit resolves — never
        // before it, which is what used to leave the message stateless-but-visible.
        expect(commitIdx).toBeGreaterThan(assistantSavedIdx);
        expect(successPushIdx).toBeGreaterThan(commitIdx);
    });

    it("still reaches state on every path that decided no (or no usable) snapshot applies", () => {
        // The catch branch (stale-base refusal / commit failure) and the else branch (no
        // artifact this turn: plain chat reply, parse error, unapplied focus patch) both still
        // call the gate directly with the plain message — the chat keeps working without a
        // snapshot, but only ever through the gate, never by reintroducing a raw push ahead of
        // the decision.
        const occurrences = handleSendSource.split("addAssistantMessageToConv(assistantSaved.message)").length - 1;
        expect(occurrences).toBe(2);
    });

    it("attaches a snapshotId to the message in exactly one place (buildAssistantMessageForConv)", () => {
        expect(fullSource).toContain("function buildAssistantMessageForConv(");
        // If a second, ad-hoc metadata merge that stamps snapshotId reappears elsewhere in the
        // file, that is a new place the SSOT ordering rule can be violated again.
        const occurrences = fullSource.split("snapshotId: snapshot.id").length - 1;
        expect(occurrences).toBe(1);
    });
});
