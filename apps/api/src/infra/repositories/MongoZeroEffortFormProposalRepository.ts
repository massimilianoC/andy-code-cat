import { randomUUID } from "crypto";
import type { Collection, Filter } from "mongodb";
import { getDb } from "../db/mongo";
import type { NewZeroEffortFormProposal, ZeroEffortFormProposal } from "../../domain/entities/ZeroEffortForm";
import type {
    ZeroEffortFormProposalRecord,
    ZeroEffortFormProposalRepository,
} from "../../domain/repositories/ZeroEffortFormProposalRepository";

const COLLECTION = "zero_effort_form_proposals";

interface ZeroEffortFormProposalDocument {
    _id: string;
    workSessionId: string;
    userId: string;
    projectId?: string;
    prefilled: ZeroEffortFormProposal["prefilled"];
    editedFields: string[];
    prefillPromptExecutionLogId?: string;
    briefContentHash?: string;
    createdAt: Date;
}

function toEntity(doc: ZeroEffortFormProposalDocument): ZeroEffortFormProposal {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest };
}

export class MongoZeroEffortFormProposalRepository implements ZeroEffortFormProposalRepository {
    private async col(): Promise<Collection<ZeroEffortFormProposalDocument>> {
        const db = await getDb();
        return db.collection<ZeroEffortFormProposalDocument>(COLLECTION);
    }

    async record(proposal: NewZeroEffortFormProposal): Promise<ZeroEffortFormProposalRecord> {
        const col = await this.col();
        const doc: ZeroEffortFormProposalDocument = {
            _id: randomUUID(),
            ...proposal,
            createdAt: new Date(),
        };
        await col.insertOne(doc);
        return toEntity(doc);
    }

    async recordDecision(
        workSessionId: string,
        userId: string,
        decision: { editedFields: string[]; briefContentHash?: string; projectId?: string },
    ): Promise<void> {
        const col = await this.col();
        // The most recent proposal in this session is the one the user was looking at when they
        // submitted. A session can hold several — a user who re-runs the prefill gets a new
        // proposal — and the decision belongs to the last one shown, not the first.
        //
        // Ordered by $natural rather than createdAt: two proposals recorded in the same millisecond
        // carry identical timestamps, and the tie then resolves arbitrarily — which would attribute
        // the user's edits to a suggestion they never saw. $natural is insertion order, and these
        // documents are only ever inserted and updated in place, never deleted, so it is stable.
        const latest = await col
            .find({ workSessionId, userId } as Filter<ZeroEffortFormProposalDocument>)
            .sort({ $natural: -1 })
            .limit(1)
            .toArray();
        const target = latest[0];
        if (!target) return;

        await col.updateOne(
            { _id: target._id } as Filter<ZeroEffortFormProposalDocument>,
            {
                $set: {
                    editedFields: decision.editedFields,
                    ...(decision.briefContentHash ? { briefContentHash: decision.briefContentHash } : {}),
                    ...(decision.projectId ? { projectId: decision.projectId } : {}),
                },
            },
        );
    }

    async listByWorkSession(workSessionId: string, userId: string): Promise<ZeroEffortFormProposalRecord[]> {
        const col = await this.col();
        const docs = await col
            .find({ workSessionId, userId } as Filter<ZeroEffortFormProposalDocument>)
            // Same reasoning as recordDecision: insertion order, not a millisecond timestamp that
            // two proposals in one tick would share.
            .sort({ $natural: 1 })
            .toArray();
        return docs.map(toEntity);
    }
}
