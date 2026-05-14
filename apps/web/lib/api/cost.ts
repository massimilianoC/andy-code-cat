import { call } from "./call";
import { getAccessToken } from "../token-store";
import type {
    ProjectCostSummaryDto,
    UserCostSummaryDto,
    AdminCostDashboardDto,
    PagedCostTransactionsDto,
    CostRatesDto,
    ResourceTypeCostPolicyDto,
} from "@andy-code-cat/contracts";

export type { ProjectCostSummaryDto, UserCostSummaryDto, AdminCostDashboardDto, PagedCostTransactionsDto, CostRatesDto, ResourceTypeCostPolicyDto };

function authHeader(): Record<string, string> {
    const token = getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getProjectCostSummary(projectId: string): Promise<ProjectCostSummaryDto> {
    return call<ProjectCostSummaryDto>(
        "GET",
        `/v1/projects/${encodeURIComponent(projectId)}/cost`,
        undefined,
        { ...authHeader(), "x-project-id": projectId },
    );
}

export async function getProjectCostTransactions(
    projectId: string,
    page = 1,
    limit = 50,
): Promise<PagedCostTransactionsDto> {
    return call<PagedCostTransactionsDto>(
        "GET",
        `/v1/projects/${encodeURIComponent(projectId)}/cost/transactions?page=${page}&limit=${limit}`,
        undefined,
        { ...authHeader(), "x-project-id": projectId },
    );
}

export async function getUserCostSummary(): Promise<UserCostSummaryDto> {
    return call<UserCostSummaryDto>("GET", "/v1/users/me/cost", undefined, authHeader());
}

export async function getAdminCostDashboard(
    from?: string,
    to?: string,
): Promise<AdminCostDashboardDto> {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return call<AdminCostDashboardDto>("GET", `/v1/admin/cost/dashboard${qs}`, undefined, authHeader());
}

export async function getAdminCostTransactions(
    filter?: {
        userId?: string;
        projectId?: string;
        resourceType?: string;
        status?: "settled" | "voided";
        from?: string;
        to?: string;
    },
    page = 1,
    limit = 50,
): Promise<PagedCostTransactionsDto> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filter?.userId) params.set("userId", filter.userId);
    if (filter?.projectId) params.set("projectId", filter.projectId);
    if (filter?.resourceType) params.set("resourceType", filter.resourceType);
    if (filter?.status) params.set("status", filter.status);
    if (filter?.from) params.set("from", filter.from);
    if (filter?.to) params.set("to", filter.to);
    return call<PagedCostTransactionsDto>("GET", `/v1/admin/cost/transactions?${params.toString()}`, undefined, authHeader());
}

export async function updateCostRates(rates: Partial<Omit<CostRatesDto, "updatedAt" | "updatedByUserId">>): Promise<{ costRates: CostRatesDto }> {
    return call<{ costRates: CostRatesDto }>("PATCH", "/v1/admin/cost/rates", rates, authHeader());
}
