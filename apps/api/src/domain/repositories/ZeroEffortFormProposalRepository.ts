import type { NewZeroEffortFormProposal, ZeroEffortFormProposal } from "../entities/ZeroEffortForm";

export type ZeroEffortFormProposalRecord = ZeroEffortFormProposal;

export interface ZeroEffortFormProposalRepository {
    /** Records what the prefill proposed, at the moment it proposed it. */
    record(proposal: NewZeroEffortFormProposal): Promise<ZeroEffortFormProposalRecord>;

    /**
     * Fills in what the user changed, once they submit. Called from the launch path, because that is
     * the first moment both sides of the comparison exist — the proposal recorded earlier and the
     * form as confirmed. Answering "did the user accept the model's suggestion or overrule it" is
     * question 4 of docs/specs/SESSION_RECONSTRUCTION_CERTIFICATE.md §3, and it is the one fact
     * nothing else in the database holds.
     */
    recordDecision(
        workSessionId: string,
        userId: string,
        decision: { editedFields: string[]; briefContentHash?: string; projectId?: string },
    ): Promise<void>;

    listByWorkSession(workSessionId: string, userId: string): Promise<ZeroEffortFormProposalRecord[]>;
}
