import { describe, expect, it } from "vitest";
import { buildNormalizedBrief } from "../LaunchGuidedProject";

describe("buildNormalizedBrief", () => {
    it("keeps the original request authoritative and emits every expressive section", () => {
        const brief = buildNormalizedBrief({
            businessName: "Runner Lab",
            presetId: "freerunner",
            outputLanguage: "it",
            sourceRequest: "Crea un infinite runner senza acquisti in-app.",
            primaryGoal: "Un runner arcade completo.",
            audience: "Studenti e giocatori casual.",
            projectSummary: "Esperienza rapida ambientata in una scuola d'arte.",
            contentStructure: "Start, tutorial, partita, game over e retry.",
            contentRequirements: "Titolo, istruzioni, punteggio e record.",
            functionalRequirements: "Corsa automatica, salto, ostacoli e collisioni.",
            interactionModel: "Tastiera e touch con feedback immediato.",
            visualDirection: "Collage editoriale ad alto contrasto.",
            successCriteria: "Partita completa e rigiocabile senza ricaricare.",
            constraints: "Responsive e accessibile da tastiera.",
            mustAvoid: "Nessun acquisto in-app.",
        });

        expect(brief).toContain("Free Runner (freerunner)");
        expect(brief).toContain("[SOURCE_REQUEST]");
        expect(brief).toContain("on conflict, this source request wins");
        for (const section of ["[CONCEPT]", "[STRUCTURE]", "[CONTENT]", "[FUNCTIONS]", "[INTERACTIONS]", "[VISUAL_DIRECTION]", "[SUCCESS]", "[CONSTRAINTS]", "[MUST_AVOID]"]) {
            expect(brief).toContain(section);
        }
    });

    it("uses the primary goal as source authority for backward-compatible manual drafts", () => {
        const brief = buildNormalizedBrief({
            businessName: "Acme",
            presetId: "landing",
            primaryGoal: "Preserva esattamente questa richiesta.",
            audience: "Clienti",
        });
        expect(brief).toContain("[SOURCE_REQUEST]");
        expect(brief).toContain("Preserva esattamente questa richiesta.");
    });
});
