export type DidacticDifficulty = "base" | "intermediate" | "advanced";

export interface DidacticAnchor {
    kind: "preview" | "html" | "css" | "js" | "prompt";
    pfId?: string;
    lineRange?: [number, number];
}

export interface DidacticTopic {
    id: string;
    category:
        | "html_structure"
        | "css_technique"
        | "js_function"
        | "responsiveness"
        | "accessibility"
        | "design_choice"
        | "prompt_layer";
    difficulty: DidacticDifficulty;
    title: string;
    summary: string;
    anchors: DidacticAnchor[];
}

export interface DidacticQuiz {
    id: string;
    difficulty: DidacticDifficulty;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    anchors: DidacticAnchor[];
}

export interface DidacticArtifactKnowledge {
    id: string;
    projectId: string;
    snapshotId: string;
    userId: string;
    overview: string;
    topics: DidacticTopic[];
    quizzes: DidacticQuiz[];
    groundingHash: string;
    model?: string;
    provider?: string;
    generatedAt: Date;
}
