import { ReportFilterDto } from "./dto/execute-report.dto";
import {
    portalUserIdForAccount,
    resolveAgentIds,
    systemUserIdForAccount,
} from "./dashboard-activity-markers.util";

type PrismaWhere = Record<string, unknown>;

export const DASHBOARD_PROMISE_ACTIVITY_FILTER_FIELD =
    "__dashboard_promise_activity";
export const DASHBOARD_ACTIVE_DYNAMICS_FILTER_FIELD =
    "__dashboard_active_dynamics";
export const DASHBOARD_DISPUTE_FAMILY_FILTER_FIELD =
    "__dashboard_dispute_family";

type UserDelegate = {
    findMany: (args: {
        where: Record<string, unknown>;
        select: { id: true };
    }) => Promise<Array<{ id: string }>>;
};

type DbLike = {
    user: UserDelegate;
};

export type PreparedDashboardDrillMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
    /** When true, do not AND body.businessUnitId onto top-level scope. */
    skipBodyBusinessUnitId: boolean;
};

function parseDateValue(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

/**
 * Prisma fragment for “COMPLETED Promise_to_pay activity in range by agent”
 * plus non-null promise amount — mirrors FE expandDashboardPromiseActivityWhere.
 */
export function expandDashboardPromiseActivityWhere(input: {
    start: Date;
    end: Date;
    agentIdsExclAudit: string[];
}): PrismaWhere {
    return {
        promise_to_pay_amount: { not: null },
        Activity: {
            some: {
                created_by: { in: input.agentIdsExclAudit },
                type: "Promise_to_pay",
                status: "COMPLETED",
                created_at: {
                    gte: input.start,
                    lte: input.end,
                },
            },
        },
    };
}

/**
 * Period month for active-customers: future month adjusts to previous year
 * (legacy chart-details / FE resolveActiveCustomersPeriodMonth).
 */
export function resolveActiveCustomersPeriodMonth(
    period: string | null | undefined,
    now = new Date()
): { year: number; monthIndex: number } | null {
    if (!period || !/^\d{4}-\d{2}/.test(period)) {
        return null;
    }
    const [yearStr, monthStr] = period.split("-");
    let year = parseInt(yearStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1;
    if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
        return null;
    }
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    if (
        year > currentYear ||
        (year === currentYear && monthIndex > currentMonth)
    ) {
        year = year - 1;
    }
    return { year, monthIndex };
}

export function activeCustomersPeriodDateRange(
    period: string | null | undefined,
    now = new Date()
): { start: Date; end: Date } | null {
    const resolved = resolveActiveCustomersPeriodMonth(period, now);
    if (!resolved) {
        return null;
    }
    const { year, monthIndex } = resolved;
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
    return { start, end };
}

/**
 * Expand active-dynamics marker into Prisma OR matching chart-details.
 * BU is applied only to the Entered (Active) branch.
 */
export function expandDashboardActiveDynamicsWhere(
    periodYyyyMm: string,
    options: {
        businessUnitFilter?: PrismaWhere;
        now?: Date;
    } = {}
): PrismaWhere | null {
    const range = activeCustomersPeriodDateRange(
        periodYyyyMm,
        options.now
    );
    if (!range) {
        return null;
    }

    const entered: PrismaWhere = {
        collection_status: "Active",
        created_at: { gte: range.start, lte: range.end },
    };
    if (
        options.businessUnitFilter &&
        Object.keys(options.businessUnitFilter).length > 0
    ) {
        Object.assign(entered, options.businessUnitFilter);
    }

    const exited: PrismaWhere = {
        collection_status: "Inactive",
        modified_at: { gte: range.start, lte: range.end },
    };

    return { OR: [entered, exited] };
}

export type DashboardDisputeChartFamily = "created" | "closed";

/**
 * Expand dispute family marker into Prisma extras matching operation-dashboard
 * details (FE expandDashboardDisputeFamilyWhere).
 */
export function expandDashboardDisputeFamilyWhere(
    family: DashboardDisputeChartFamily,
    options: {
        agentIds: string[];
        systemUserId: string;
        portalUserId: string;
    }
): PrismaWhere {
    const { agentIds, systemUserId, portalUserId } = options;
    const auditIds = [portalUserId, systemUserId];

    if (family === "created") {
        return {
            created_by: { notIn: auditIds },
            OR: [
                { created_by: { in: agentIds } },
                { owner_id: { in: agentIds } },
            ],
        };
    }

    return {
        OR: [
            { created_by: { in: agentIds } },
            { owner_id: { in: agentIds } },
            { modified_by: { in: agentIds } },
        ],
        modified_by: { notIn: auditIds },
    };
}

/**
 * Strip CustomerCollectionPeriod promise marker and expand Activity.some membership.
 */
export async function prepareDashboardPromiseMarkers(
    filters: ReportFilterDto[],
    options: {
        db: DbLike;
        accountId: number;
        selectedUserId?: string | null;
    }
): Promise<PreparedDashboardDrillMarkers> {
    if (!filters?.length) {
        return { filters: filters ?? [], skipBodyBusinessUnitId: false };
    }

    const markerIndex = filters.findIndex(
        (f) =>
            f.table === "CustomerCollectionPeriod" &&
            f.field === DASHBOARD_PROMISE_ACTIVITY_FILTER_FIELD
    );
    if (markerIndex < 0) {
        return { filters, skipBodyBusinessUnitId: false };
    }

    const marker = filters[markerIndex];
    const raw =
        marker.value && typeof marker.value === "object"
            ? (marker.value as { start?: unknown; end?: unknown })
            : null;
    const start = parseDateValue(raw?.start);
    const end = parseDateValue(raw?.end);
    const rest = filters.filter((_, i) => i !== markerIndex);

    if (!start || !end) {
        return { filters: rest, skipBodyBusinessUnitId: false };
    }

    const agentIdsExclAudit = await resolveAgentIds({
        db: options.db,
        accountId: options.accountId,
        selectedUserId: options.selectedUserId,
    });

    return {
        filters: rest,
        primaryWhereExtras: expandDashboardPromiseActivityWhere({
            start,
            end,
            agentIdsExclAudit,
        }),
        skipBodyBusinessUnitId: false,
    };
}

/**
 * Strip Customer active-dynamics marker and expand Entered/Exited OR.
 * body.businessUnitId must be folded into the Entered branch only.
 */
export async function prepareDashboardActiveDynamicsMarkers(
    filters: ReportFilterDto[],
    options: {
        businessUnitFilter?: PrismaWhere;
    }
): Promise<PreparedDashboardDrillMarkers> {
    if (!filters?.length) {
        return { filters: filters ?? [], skipBodyBusinessUnitId: false };
    }

    const markerIndex = filters.findIndex(
        (f) =>
            f.table === "Customer" &&
            f.field === DASHBOARD_ACTIVE_DYNAMICS_FILTER_FIELD
    );
    if (markerIndex < 0) {
        return { filters, skipBodyBusinessUnitId: false };
    }

    const period = String(filters[markerIndex].value || "").slice(0, 7);
    const rest = filters.filter((_, i) => i !== markerIndex);
    const expanded = expandDashboardActiveDynamicsWhere(period, {
        businessUnitFilter: options.businessUnitFilter,
    });

    return {
        filters: rest,
        primaryWhereExtras: expanded ?? undefined,
        // Dashboard BU is encoded on the Entered branch only (legacy asymmetry).
        skipBodyBusinessUnitId: true,
    };
}

/**
 * Strip Dispute family marker and expand agent / audit-user membership.
 * Date/status filters remain as normal report filters.
 */
export async function prepareDashboardDisputeMarkers(
    filters: ReportFilterDto[],
    options: {
        db: DbLike;
        accountId: number;
        selectedUserId?: string | null;
    }
): Promise<PreparedDashboardDrillMarkers> {
    if (!filters?.length) {
        return { filters: filters ?? [], skipBodyBusinessUnitId: false };
    }

    const markerIndex = filters.findIndex(
        (f) =>
            f.table === "Dispute" &&
            f.field === DASHBOARD_DISPUTE_FAMILY_FILTER_FIELD
    );
    if (markerIndex < 0) {
        return { filters, skipBodyBusinessUnitId: false };
    }

    const familyRaw = String(filters[markerIndex].value || "").toLowerCase();
    const family: DashboardDisputeChartFamily | null =
        familyRaw === "created" || familyRaw === "closed" ? familyRaw : null;
    const rest = filters.filter((_, i) => i !== markerIndex);

    if (!family) {
        return { filters: rest, skipBodyBusinessUnitId: false };
    }

    const agentIds = await resolveAgentIds({
        db: options.db,
        accountId: options.accountId,
        selectedUserId: options.selectedUserId,
    });

    return {
        filters: rest,
        primaryWhereExtras: expandDashboardDisputeFamilyWhere(family, {
            agentIds,
            systemUserId: systemUserIdForAccount(options.accountId),
            portalUserId: portalUserIdForAccount(options.accountId),
        }),
        skipBodyBusinessUnitId: false,
    };
}
