import type { CostTransaction, CostSourceRef } from "../entities/CostTransaction";

export interface CostSummary {
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    txCount: number;
}

export interface CostTypeBreakdown {
    resourceType: string;
    totalEur: number;
    providerCostEur: number;
    infraCostEur: number;
    platformMarkupEur: number;
    txCount: number;
}

export interface CostTrendPoint {
    date: string; // YYYY-MM-DD
    totalEur: number;
    txCount: number;
}

export interface PageOpts {
    page: number;
    limit: number;
}

export interface PagedResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
}

export interface AdminCostFilter {
    userId?: string;
    projectId?: string;
    resourceType?: string;
    status?: "settled" | "voided";
    fromDate?: Date;
    toDate?: Date;
}

export interface ICostTransactionRepository {
    create(tx: Omit<CostTransaction, "id" | "createdAt">): Promise<CostTransaction>;
    findById(id: string): Promise<CostTransaction | null>;
    findBySourceRef(ref: Partial<CostSourceRef>): Promise<CostTransaction[]>;

    sumByProject(projectId: string): Promise<CostSummary>;
    sumByUser(userId: string, fromDate?: Date): Promise<CostSummary>;

    breakdownByTypeForProject(projectId: string): Promise<CostTypeBreakdown[]>;
    breakdownByTypeForUser(userId: string, fromDate?: Date): Promise<CostTypeBreakdown[]>;
    breakdownByTypePlatform(fromDate?: Date, toDate?: Date): Promise<CostTypeBreakdown[]>;

    trendByProject(projectId: string, days: number): Promise<CostTrendPoint[]>;
    trendByUser(userId: string, days: number): Promise<CostTrendPoint[]>;
    trendPlatform(days: number): Promise<CostTrendPoint[]>;

    listByProject(projectId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>>;
    listByUser(userId: string, opts: PageOpts): Promise<PagedResult<CostTransaction>>;
    listAll(filter: AdminCostFilter, opts: PageOpts): Promise<PagedResult<CostTransaction>>;

    topProjectsByUser(userId: string, limit?: number): Promise<Array<{ projectId: string; totalEur: number }>>;
    topProjectsPlatform(fromDate?: Date, toDate?: Date, limit?: number): Promise<Array<{ projectId: string; totalEur: number }>>;

    voidTransaction(txId: string, voidedByTxId: string): Promise<void>;
}
