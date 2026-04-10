export type PublishAction = "publish" | "republish";

export interface PublishHistoryEntry {
    id: string;
    projectId: string;
    userId: string;
    publishId: string;
    deploymentId: string;
    snapshotId: string;
    action: PublishAction;
    publishedAt: Date;
}
