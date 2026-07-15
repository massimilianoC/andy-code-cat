import { VIBE_SELECTABLE_PRESETS } from "./vibePresetCatalog";

const SELECTABLE_TEMPLATE_IDS = new Set(VIBE_SELECTABLE_PRESETS.map((p) => p.id));

function selectableTemplate(id: string): string | null {
    return SELECTABLE_TEMPLATE_IDS.has(id) ? id : null;
}

export function inferDeterministicVibeTemplate(prompt: string): { templateId: string; reasoning: string } | null {
    const normalized = prompt.toLowerCase();
    const hasAny = (terms: RegExp[]) => terms.some((term) => term.test(normalized));

    if (hasAny([/\bvr\b/, /\bwebxr\b/, /\ba-?frame\b/, /\bheadset\b/, /\bimmersive\b/])) {
        const templateId = selectableTemplate("vr-aframe");
        return templateId ? { templateId, reasoning: "deterministic match: VR or immersive experience intent" } : null;
    }

    if (hasAny([/\bbranching story\b/, /\bchoose your own\b/, /\binteractive story\b/, /\bnarrative choices\b/])) {
        const templateId = selectableTemplate("interactive-story");
        return templateId ? { templateId, reasoning: "deterministic match: branching interactive story intent" } : null;
    }

    const runnerSignals = [
        /\binfinite runner\b/, /\bendless runner\b/, /\brunner infinito\b/, /\bcorsa infinita\b/,
        /\bgioco (?:di )?corsa infinita\b/, /\bjeu de course infini\b/, /\bjuego de carrera infinita\b/,
    ];
    if (hasAny(runnerSignals)) {
        const templateId = selectableTemplate("freerunner");
        return templateId ? { templateId, reasoning: "deterministic match: infinite runner intent" } : null;
    }

    const gameSignals = [
        /\bgame\b/, /\bvideogame\b/, /\bplayable\b/, /\bplay\b/, /\bplayer\b/, /\bscore\b/, /\blevels?\b/,
        /\bhud\b/, /\bcontrols?\b/, /\bupgrade\b/, /\bupgrades?\b/, /\bmission\b/, /\bquests?\b/,
        /\bwin\b/, /\blose\b/, /\bgame over\b/, /\bship\b/, /\bspaceship\b/, /\bspace ship\b/,
        /\bgioco\b/, /\bvideogioco\b/, /\bgiocabile\b/, /\bgiocatore\b/, /\bpunteggio\b/, /\blivelli?\b/,
        /\bcomandi\b/, /\bostacoli?\b/, /\bpartita\b/, /\bgameplay\b/,
    ];
    const space3dSignals = [
        /\bspace\b/, /\bspore\b/, /\bstars?\b/, /\bplanets?\b/, /\bgalax(y|ies)\b/, /\borbit\b/,
        /\bspaceship\b/, /\bspace ship\b/, /\bfly\b/, /\bflying\b/, /\bzoom\b/, /\b3d\b/,
    ];
    const learningSignals = [/\blearning\b/, /\btraining\b/, /\beducation(al)?\b/, /\bteach\b/, /\btutorial\b/, /\bformazione\b/, /\beducativ[oa]\b/, /\bdidattic[oa]\b/];

    if (hasAny(gameSignals) && hasAny(learningSignals)) {
        const templateId = selectableTemplate("seriousgame");
        return templateId ? { templateId, reasoning: "deterministic match: learning or training game intent" } : null;
    }

    if (hasAny(gameSignals) && hasAny(space3dSignals)) {
        const templateId = selectableTemplate("game3d");
        return templateId ? { templateId, reasoning: "deterministic match: 3D or spatial playable game intent" } : null;
    }

    if (hasAny(gameSignals)) {
        const templateId = selectableTemplate("videogame");
        return templateId ? { templateId, reasoning: "deterministic match: playable game intent" } : null;
    }

    return null;
}
