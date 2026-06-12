export interface DidacticQnaFocus {
    kind: "preview" | "html" | "css" | "js";
    pfId?: string;
    outerHtml?: string;
    lineRange?: [number, number];
    selectedText?: string;
}

export interface DidacticQnaEntry {
    id: string;
    projectId: string;
    userId: string;
    snapshotId: string;
    focus?: DidacticQnaFocus;
    question: string;
    answer: string;
    model?: string;
    provider?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    createdAt: Date;
}
