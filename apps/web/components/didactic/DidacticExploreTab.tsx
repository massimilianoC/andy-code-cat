"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, Sparkles, Lightbulb, CheckCircle, XCircle } from "lucide-react";
import type { DidacticArtifactKnowledge, DidacticTopic, DidacticQuiz, DidacticDifficulty } from "@andy-code-cat/contracts";

interface DidacticExploreTabProps {
    status: "ready" | "stale" | "absent";
    knowledge?: DidacticArtifactKnowledge;
    onGenerate: () => void;
    onRegenerate: () => void;
    generating: boolean;
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

function groupByCategory(topics: DidacticTopic[]) {
    const map = new Map<string, DidacticTopic[]>();
    for (const t of topics) {
        const list = map.get(t.category) ?? [];
        list.push(t);
        map.set(t.category, list);
    }
    return map;
}

const CATEGORY_LABELS: Record<string, string> = {
    html_structure: "HTML",
    css_technique: "CSS",
    js_function: "JavaScript",
    responsiveness: "Responsive",
    accessibility: "Accessibilità",
    design_choice: "Design",
    prompt_layer: "Prompt",
};

export function DidacticExploreTab({ status, knowledge, onGenerate, onRegenerate, generating }: DidacticExploreTabProps) {
    const [quizAnswers, setQuizAnswers] = useState<Record<string, number | null>>({});
    const [quizRevealed, setQuizRevealed] = useState<Record<string, boolean>>({});

    if (status === "absent" || !knowledge) {
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

    return (
        <div className="p-4 space-y-5 relative">
            {generating && (
                <div className="absolute inset-0 z-20 bg-card/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 space-y-3">
                    <Loader2 className="animate-spin text-primary" size={40} />
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Analisi didattica in corso...</p>
                        <p className="text-xs text-muted-foreground max-w-[260px]">
                            L&apos;AI sta esaminando l&apos;artifact e generando argomenti, quiz e spiegazioni.
                            Questo può richiedere 10-30 secondi.
                        </p>
                    </div>
                </div>
            )}
            {status === "stale" && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                    <Sparkles size={12} />
                    L&apos;artifact è cambiato. L&apos;analisi potrebbe non essere aggiornata.
                    <Button type="button" variant="ghost" size="sm" className="h-auto text-xs py-0 px-2 ml-auto" onClick={onRegenerate} disabled={generating}>
                        {generating ? <Loader2 className="animate-spin" size={12} /> : "Rigenera"}
                    </Button>
                </div>
            )}

            {/* Overview */}
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Panoramica</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground leading-relaxed">{knowledge.overview}</p>
                </CardContent>
            </Card>

            {/* Topics */}
            <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Argomenti</h3>
                {Array.from(grouped.entries()).map(([category, topics]) => (
                    <div key={category} className="space-y-2">
                        <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[category] ?? category}</Badge>
                        <div className="space-y-2">
                            {topics.map((t) => (
                                <Card key={t.id} className="cursor-pointer hover:bg-muted/40 transition-colors">
                                    <CardContent className="p-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-sm font-medium">{t.title}</span>
                                            <Badge variant={DIFFICULTY_VARIANTS[t.difficulty]} className="text-[10px] px-1 py-0">
                                                {DIFFICULTY_LABELS[t.difficulty]}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{t.summary}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <Separator />

            {/* Quizzes */}
            <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quiz ({knowledge.quizzes.length})</h3>
                {knowledge.quizzes.map((q, idx) => (
                    <QuizCard
                        key={q.id}
                        index={idx + 1}
                        quiz={q}
                        selected={quizAnswers[q.id] ?? null}
                        revealed={quizRevealed[q.id] ?? false}
                        onSelect={(i) => setQuizAnswers((prev) => ({ ...prev, [q.id]: i }))}
                        onReveal={() => setQuizRevealed((prev) => ({ ...prev, [q.id]: true }))}
                    />
                ))}
            </div>
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
    quiz: DidacticQuiz;
    selected: number | null;
    revealed: boolean;
    onSelect: (i: number) => void;
    onReveal: () => void;
}) {
    return (
        <Card>
            <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{index}.</span>
                    <span className="text-sm">{quiz.question}</span>
                    <Badge variant={DIFFICULTY_VARIANTS[quiz.difficulty]} className="text-[10px] px-1 py-0 ml-auto">
                        {DIFFICULTY_LABELS[quiz.difficulty]}
                    </Badge>
                </div>
                <div className="space-y-1">
                    {quiz.options.map((opt, i) => {
                        const isCorrect = i === quiz.correctIndex;
                        const isSelected = selected === i;
                        let btnVariant: "outline" | "default" | "secondary" | "ghost" | "destructive" = "outline";
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
                {revealed && (
                    <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">{quiz.explanation}</p>
                )}
            </CardContent>
        </Card>
    );
}
