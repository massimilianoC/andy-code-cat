import type { DidacticArtifactKnowledge } from "../../domain/entities/DidacticArtifactKnowledge";
import type { DidacticArtifactKnowledgeRepository } from "../../domain/repositories/DidacticArtifactKnowledgeRepository";
import type { PreviewSnapshot } from "../../domain/entities/PreviewSnapshot";

interface Input {
    projectId: string;
    snapshotId: string;
    currentSnapshot: PreviewSnapshot;
}

interface Output {
    status: "ready" | "stale" | "absent";
    knowledge?: DidacticArtifactKnowledge;
}

function computeGroundingHash(snapshot: PreviewSnapshot): string {
    const { html, css, js } = snapshot.artifacts;
    const trace = snapshot.metadata?.promptingTrace;
    const traceStr = trace
        ? `${trace.originalUserMessage}\n${trace.prePromptTemplate ?? ""}\n${trace.effectiveSystemPrompt ?? ""}`
        : "";
    // simple hash via Buffer (Node.js)
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(html + css + js + traceStr).digest("hex").slice(0, 32);
}

export class GetDidacticKnowledge {
    constructor(private repo: DidacticArtifactKnowledgeRepository) {}

    async execute(input: Input): Promise<Output> {
        const knowledge = await this.repo.findByProjectAndSnapshot(input.projectId, input.snapshotId);
        if (!knowledge) {
            return { status: "absent" };
        }
        const expectedHash = computeGroundingHash(input.currentSnapshot);
        if (knowledge.groundingHash !== expectedHash) {
            return { status: "stale", knowledge };
        }
        return { status: "ready", knowledge };
    }
}
