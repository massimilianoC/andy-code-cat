"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, Lightbulb, CheckCircle, XCircle, ExternalLink, ChevronDown } from "lucide-react";
import type { DidacticArtifactKnowledge, DidacticTopic, DidacticQuiz, DidacticDifficulty } from "@andy-code-cat/contracts";

interface DidacticExploreTabProps {
    status: "ready" | "stale" | "absent";
    knowledge?: DidacticArtifactKnowledge;
    onGenerate: () => void;
    onRegenerate: () => void;
    generating: boolean;
    /** When set, renders only the specified section of content. */
    section?: "analyze" | "quiz";
    /** Called when the user clicks a topic card that has a code anchor. */
    onAnchorClick?: (kind: "html" | "css" | "js", lineRange?: [number, number]) => void;
}

const DIFFICULTY_LABELS: Record<DidacticDifficulty, string> = {
    base: "Base",
    intermediate: "Intermedio",
    advanced: "Avanzato",
};

const DIFFICULTY_VARIANTS: Record<DidacticDifficulty, "default" | "secondary" | "destructive"> = {
    base: "default",
    intermediate: "secondary",
    advanced: "destructive",
};

const CATEGORY_LABELS: Record<string, string> = {
    html_structure: "HTML",
    css_technique: "CSS",
    js_function: "JavaScript",
    responsiveness: "Responsive",
    accessibility: "Accessibilità",
    design_choice: "Design",
    prompt_layer: "Prompt",
};

// Maps a topic category to a fallback code tab when the anchor kind is not directly usable.
const CATEGORY_TAB: Record<string, "html" | "css" | "js"> = {
    html_structure: "html",
    css_technique: "css",
    js_function: "js",
    responsiveness: "css",
    accessibility: "html",
    design_choice: "css",
    prompt_layer: "html",
};

function groupByCategory(topics: DidacticTopic[]) {
    const map = new Map<string, DidacticTopic[]>();
    for (const t of topics) {
        const list = map.get(t.category) ?? [];
        list.push(t);
        map.set(t.category, list);
    }
    return map;
}

type ShuffledQuiz = Omit<DidacticQuiz, "options" | "correctIndex"> & {
    options: string[];
    correctIndex: number;
};

function shuffleQuizOptions(quiz: DidacticQuiz): ShuffledQuiz {
    const perm = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    return {
        ...quiz,
        options: perm.map((i) => quiz.options[i]),
        correctIndex: perm.indexOf(quiz.correctIndex),
    };
}

export function DidacticExploreTab({
    status,
    knowledge,
    onGenerate,
    onRegenerate,
    generating,
    section,
    onAnchorClick,
}: DidacticExploreTabProps) {
    // State keyed by array index to avoid duplicate-ID bugs from LLM-generated content.
    const [quizAnswers, setQuizAnswers] = useState<Record<number, number | null>>({});
    const [quizRevealed, setQuizRevealed] = useState<Record<number, boolean>>({});
    // Accordion: at most one topic open at a time — a generation returns 6-10 topics, and having
    // all of them expanded is exactly the "wall of text" the accordion exists to avoid.
    const [openTopicId, setOpenTopicId] = useState<string | null>(null);

    // Reset quiz state and reshuffle when a new knowledge artifact is loaded.
    useEffect(() => {
        setQuizAnswers({});
        setQuizRevealed({});
        setOpenTopicId(null);
    }, [knowledge?.id]);

    // Shuffle answer positions once per knowledge load, stable within the session.
    const shuffledQuizzes = useMemo<ShuffledQuiz[]>(() => {
        if (!knowledge) return [];
        return knowledge.quizzes.map(shuffleQuizOptions);
    }, [knowledge]);

    if (status === "absent" || !knowledge) {
        if (section === "quiz") {
            return (
                <div className="p-6 text-center space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Genera prima un&apos;analisi per accedere ai quiz.
                    </p>
                    <Button type="button" size="sm" onClick={onGenerate} disabled={generating}>
                        {generating ? <Loader2 className="animate-spin mr-2" size={14} /> : <Sparkles size={14} className="mr-2" />}
                        Genera analisi
                    </Button>
                </div>
            );
        }
        return (
            <div className="p-6 text-center space-y-4">
                <Lightbulb className="mx-auto text-muted-foreground" size={32} />
                <p className="text-sm text-muted-foreground">
                    Nessuna analisi didattica disponibile per questo artifact.<br />
                    Genera un&apos;analisi per esplorare argomenti, quiz e approfondimenti.
                </p>
                <Button type="button" size="sm" onClick={onGenerate} disabled={generating}>
                    {generating ? <Loader2 className="animate-spin mr-2" size={14} /> : <Sparkles size={14} className="mr-2" />}
                    Genera analisi
                </Button>
            </div>
        );
    }

    const grouped = groupByCategory(knowledge.topics);
    const showAnalyze = !section || section === "analyze";
    // Local, derived progress — nothing here is persisted or scored server-side.
    const quizAnsweredCount = Object.values(quizRevealed).filter(Boolean).length;
    const quizCorrectCount = shuffledQuizzes.filter(
        (q, idx) => quizRevealed[idx] && quizAnswers[idx] === q.correctIndex
    ).length;
    const showQuiz = !section || section === "quiz";

    return (
        <div className="p-4 space-y-5">
            {status === "stale" && showAnalyze && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                    <Sparkles size={12} />
                    L&apos;artifact è cambiato. L&apos;analisi potrebbe non essere aggiornata.
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto text-xs py-0 px-2 ml-auto"
                        onClick={onRegenerate}
                        disabled={generating}
                    >
                        {generating ? <Loader2 className="animate-spin" size={12} /> : "Rigenera"}
                    </Button>
                </div>
            )}

            {showAnalyze && (
                <>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">Panoramica</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground leading-relaxed">{knowledge.overview}</p>
                        </CardContent>
                    </Card>

                    <div className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Argomenti</h3>
                        {Array.from(grouped.entries()).map(([category, topics]) => (
                            <div key={category} className="space-y-2">
                                <Badge variant="outline" className="text-[10px]">
                                    {CATEGORY_LABELS[category] ?? category}
                                </Badge>
                                {/* Accordion, not a stack of always-open cards: a generation returns
                                    6-10 topics, and showing every summary at once is the length
                                    problem the operator flagged. Only one topic is expanded at a
                                    time, exclusively across the whole list (not per category). */}
                                <div className="space-y-2">
                                    {topics.map((t) => {
                                        const anchor = t.anchors[0];
                                        const tabKind: "html" | "css" | "js" | undefined =
                                            anchor && anchor.kind !== "preview" && anchor.kind !== "prompt"
                                                ? anchor.kind
                                                : CATEGORY_TAB[t.category];
                                        const canNavigate = !!onAnchorClick && !!tabKind;
                                        return (
                                            <TopicAccordionItem
                                                key={t.id}
                                                topic={t}
                                                category={category}
                                                isOpen={openTopicId === t.id}
                                                onToggle={() =>
                                                    setOpenTopicId((cur) => (cur === t.id ? null : t.id))
                                                }
                                                canNavigate={canNavigate}
                                                tabKind={tabKind}
                                                onNavigate={
                                                    canNavigate
                                                        ? () => onAnchorClick!(tabKind!, anchor?.lineRange)
                                                        : undefined
                                                }
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {showAnalyze && showQuiz && <Separator />}

            {showQuiz && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Quiz ({shuffledQuizzes.length})
                        </h3>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">
                                {quizAnsweredCount}/{shuffledQuizzes.length} risposti
                            </span>
                            {quizAnsweredCount > 0 && (
                                <Badge
                                    variant={quizCorrectCount === quizAnsweredCount ? "success" : "secondary"}
                                    className="text-[10px] px-1.5 py-0"
                                >
                                    {quizCorrectCount} corrette
                                </Badge>
                            )}
                        </div>
                    </div>
                    {/* Progress across the 5 quizzes — local, derived from already-revealed answers.
                        No scoring backend: nothing here is persisted. */}
                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full rounded-full bg-primary transition-[width] duration-300"
                            style={{
                                width: shuffledQuizzes.length
                                    ? `${(quizAnsweredCount / shuffledQuizzes.length) * 100}%`
                                    : "0%",
                            }}
                        />
                    </div>
                    {shuffledQuizzes.map((q, idx) => (
                        <QuizCard
                            key={idx}
                            index={idx + 1}
                            quiz={q}
                            selected={quizAnswers[idx] ?? null}
                            revealed={quizRevealed[idx] ?? false}
                            onSelect={(i) => setQuizAnswers((prev) => ({ ...prev, [idx]: i }))}
                            onReveal={() => setQuizRevealed((prev) => ({ ...prev, [idx]: true }))}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function QuizCard({
    index,
    quiz,
    selected,
    revealed,
    onSelect,
    onReveal,
}: {
    index: number;
    quiz: ShuffledQuiz;
    selected: number | null;
    revealed: boolean;
    onSelect: (i: number) => void;
    onReveal: () => void;
}) {
    // The real answered state the operator asked for: once revealed, the card carries whether
    // the chosen option was right, not just which one was picked.
    const isAnsweredCorrectly = revealed && selected === quiz.correctIndex;

    return (
        <Card className={cn(revealed && (isAnsweredCorrectly ? "border-success/40" : "border-destructive/40"))}>
            <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold shrink-0">{index}.</span>
                    <span className="text-sm flex-1">{quiz.question}</span>
                    {revealed && (
                        <Badge
                            variant={isAnsweredCorrectly ? "success" : "destructive"}
                            className="text-[10px] px-1.5 py-0 gap-1 shrink-0"
                        >
                            {isAnsweredCorrectly ? <CheckCircle size={10} /> : <XCircle size={10} />}
                            {isAnsweredCorrectly ? "Corretto" : "Errato"}
                        </Badge>
                    )}
                    <Badge
                        variant={DIFFICULTY_VARIANTS[quiz.difficulty]}
                        className="text-[10px] px-1 py-0 shrink-0"
                    >
                        {DIFFICULTY_LABELS[quiz.difficulty]}
                    </Badge>
                </div>
                <div className="space-y-1">
                    {quiz.options.map((opt, i) => {
                        const isCorrect = i === quiz.correctIndex;
                        const isSelected = selected === i;
                        let btnVariant: "outline" | "default" | "secondary" | "destructive" = "outline";
                        if (revealed) {
                            btnVariant = isCorrect ? "default" : isSelected ? "destructive" : "outline";
                        } else if (isSelected) {
                            btnVariant = "secondary";
                        }
                        return (
                            <Button
                                key={i}
                                type="button"
                                variant={btnVariant}
                                size="sm"
                                className="w-full justify-start text-xs h-auto py-1.5"
                                onClick={() => onSelect(i)}
                                disabled={revealed}
                            >
                                {revealed && isCorrect && <CheckCircle size={12} className="mr-2 shrink-0" />}
                                {revealed && isSelected && !isCorrect && <XCircle size={12} className="mr-2 shrink-0" />}
                                {opt}
                            </Button>
                        );
                    })}
                </div>
                {!revealed && selected !== null && (
                    <Button type="button" size="sm" className="text-xs" onClick={onReveal}>
                        Verifica risposta
                    </Button>
                )}
                {/* Explanation only appears after answering — never before, so the quiz stays a quiz. */}
                {revealed && (
                    <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">{quiz.explanation}</p>
                )}
            </CardContent>
        </Card>
    );
}

// ---------------------------------------------------------------------------
// One topic as a collapsible card — the accordion item. The header row (title,
// category/difficulty badges, code-anchor control) is always visible so the list stays
// scannable; the summary only renders when open, which is how 6-10 topics avoid becoming
// a wall of text. The code-anchor control is a separate hit target from the toggle (with its
// own stopPropagation) so expanding a card never fights with `onAnchorClick` navigation —
// same callback, same tabKind/lineRange resolution as before, just its own button now.
// ---------------------------------------------------------------------------
function TopicAccordionItem({
    topic,
    category,
    isOpen,
    onToggle,
    canNavigate,
    tabKind,
    onNavigate,
}: {
    topic: DidacticTopic;
    category: string;
    isOpen: boolean;
    onToggle: () => void;
    canNavigate: boolean;
    tabKind?: "html" | "css" | "js";
    onNavigate?: () => void;
}) {
    return (
        <Card className={cn("overflow-hidden transition-colors", isOpen && "border-primary/30")}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-muted/40"
            >
                <ChevronDown
                    size={13}
                    className={cn(
                        "shrink-0 text-muted-foreground transition-transform duration-200",
                        isOpen ? "rotate-180" : "-rotate-90"
                    )}
                />
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{topic.title}</span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    {CATEGORY_LABELS[category] ?? category}
                </Badge>
                <Badge
                    variant={DIFFICULTY_VARIANTS[topic.difficulty]}
                    className="text-[10px] px-1 py-0 shrink-0"
                >
                    {DIFFICULTY_LABELS[topic.difficulty]}
                </Badge>
                {canNavigate && (
                    <span
                        role="button"
                        tabIndex={0}
                        title="Vai al codice"
                        onClick={(e) => {
                            e.stopPropagation();
                            onNavigate?.();
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                onNavigate?.();
                            }
                        }}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                    >
                        <ExternalLink size={9} />
                        {tabKind!.toUpperCase()}
                    </span>
                )}
            </button>
            {isOpen && (
                <CardContent className="border-t border-border/60 px-3 pb-3 pt-2">
                    <p className="text-xs text-muted-foreground leading-relaxed">{topic.summary}</p>
                </CardContent>
            )}
        </Card>
    );
}
