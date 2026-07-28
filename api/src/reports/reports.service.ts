import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    CREDIT_DASHBOARD_CONTEXTS,
    DASHBOARD_REPORT_CONTEXTS,
    ENTITY_LIST_REPORT_CONTEXTS,
    FINANCIAL_DASHBOARD_CONTEXTS,
    OPERATION_DASHBOARD_CONTEXTS,
} from "./report.constants";
import { REPORT_METADATA } from "./report-metadata";
import { REPORT_RELATIONSHIPS } from "./report-relationships";

@Injectable()
export class ReportsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly access: AccessScopeService
    ) {}

    async list(user: JwtPayload, query: Record<string, string | undefined>) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const context = query.context;
        const isDefaultRequest =
            query.default === "true" || query.default === "1";

        await this.assertListPermission(accountId, role, context);

        const accountRow = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true } as never,
        });
        const filterCi =
            !(accountRow as { has_credit_insurance?: boolean } | null)
                ?.has_credit_insurance;

        if (isDefaultRequest && context) {
            const defaultView = await this.resolveDefaultView(
                accountId,
                userId,
                context,
                role,
                filterCi
            );
            if (!defaultView) {
                return {
                    reports: [],
                    totalRecords: 0,
                    page: 1,
                    limit: 1,
                };
            }
            return {
                reports: [this.formatReportDates(defaultView)],
                totalRecords: 1,
                page: 1,
                limit: 1,
            };
        }

        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(
            100,
            Math.max(1, parseInt(query.limit || "20", 10) || 20)
        );
        const search = (query.search || "").trim();
        const sortField = query.sortField || "modified_at";
        const sortDirection =
            (query.sortDirection || "desc").toLowerCase() === "asc"
                ? "asc"
                : "desc";

        const where: Record<string, unknown> = {
            AND: [
                {
                    OR: [
                        { account_id: accountId },
                        { is_system: true },
                        {
                            is_public: true,
                            ReportShare: {
                                some: {
                                    OR: [
                                        { shared_with_user_id: userId },
                                        { shared_with_role: role as never },
                                    ],
                                },
                            },
                        },
                        { created_by: userId },
                    ],
                },
            ],
        };
        if (context) {
            (where.AND as unknown[]).push({ context });
        }
        if (search) {
            (where.AND as unknown[]).push({
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    {
                        unique_name: {
                            contains: search,
                            mode: "insensitive",
                        },
                    },
                ],
            });
        }
        if (filterCi) {
            (where.AND as unknown[]).push({
                NOT: {
                    OR: [
                        { context: { contains: "credit" } },
                        { unique_name: { contains: "credit_insurance" } },
                    ],
                },
            });
        }

        const allowedSort = new Set([
            "name",
            "modified_at",
            "created_at",
            "unique_name",
            "context",
        ]);
        const orderBy = {
            [allowedSort.has(sortField) ? sortField : "modified_at"]:
                sortDirection,
        };

        const [rows, totalRecords] = await Promise.all([
            this.db.report.findMany({
                where: where as never,
                orderBy: orderBy as never,
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.report.count({ where: where as never }),
        ]);

        return serializeBigInt({
            reports: rows.map((r) => this.formatReportDates(r)),
            totalRecords,
            page,
            limit,
        });
    }

    async getById(user: JwtPayload, id: number) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const report = await this.db.report.findFirst({
            where: {
                id,
                OR: [
                    { account_id: accountId },
                    { is_system: true },
                    { is_public: true },
                ],
            },
        });
        if (!report) {
            throw new NotFoundException("Report not found");
        }
        // Match legacy pages/api contract: clients read `data.report`.
        return serializeBigInt({
            report: this.formatReportDates(report),
        });
    }

    async create(user: JwtPayload, body: Record<string, unknown>) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (
            !(await this.access.hasPermission(
                accountId,
                role,
                "manage_reports"
            )) &&
            !(await this.access.hasPermission(accountId, role, "view_reports"))
        ) {
            throw new ForbiddenException("Cannot create reports");
        }
        const name = String(body.name || "").trim();
        if (!name) {
            throw new BadRequestException("name is required");
        }
        const unique_name =
            String(body.unique_name || name)
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, "_")
                .slice(0, 200) || `report_${Date.now()}`;
        const created = await this.db.report.create({
            data: {
                account_id: accountId,
                name,
                unique_name,
                description: (body.description as string) || null,
                report_config: (body.report_config as never) || {
                    tables: [],
                    fields: [],
                    filters: [],
                },
                is_public: Boolean(body.is_public),
                is_system: false,
                is_default: Boolean(body.is_default),
                context: (body.context as string) || null,
                created_by: userId,
                modified_by: userId,
            },
        });
        return serializeBigInt({
            report: this.formatReportDates(created),
        });
    }

    async update(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const existing = await this.db.report.findFirst({
            where: { id, account_id: accountId, is_system: false },
        });
        if (!existing) {
            throw new NotFoundException("Report not found");
        }
        const data: Record<string, unknown> = { modified_by: userId };
        for (const key of [
            "name",
            "description",
            "report_config",
            "is_public",
            "is_default",
            "context",
            "unique_name",
        ] as const) {
            if (body[key] !== undefined) {
                data[key] = body[key];
            }
        }
        const updated = await this.db.report.update({
            where: { id },
            data: data as never,
        });
        return serializeBigInt({
            report: this.formatReportDates(updated),
        });
    }

    async remove(user: JwtPayload, id: number) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const existing = await this.db.report.findFirst({
            where: { id, account_id: accountId, is_system: false },
        });
        if (!existing) {
            throw new NotFoundException("Report not found");
        }
        await this.db.report.delete({ where: { id } });
        return { success: true };
    }

    async metadata(user: JwtPayload) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (
            !(await this.access.hasPermission(accountId, role, "view_reports"))
        ) {
            throw new ForbiddenException(
                "You do not have permission to view report metadata"
            );
        }

        return {
            tables: REPORT_METADATA.tables,
            relationships: REPORT_RELATIONSHIPS,
        };
    }

    async getUserDefault(user: JwtPayload, context: string) {
        if (!context) {
            throw new BadRequestException("Context is required");
        }
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        await this.assertListPermission(accountId, role, context);

        const accountRow = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true } as never,
        });
        const filterCi =
            !(accountRow as { has_credit_insurance?: boolean } | null)
                ?.has_credit_insurance;

        const view = await this.resolveDefaultView(
            accountId,
            userId,
            context,
            role,
            filterCi
        );
        return serializeBigInt({
            report: view ? this.formatReportDates(view) : null,
        });
    }

    async setUserDefault(
        user: JwtPayload,
        context: string,
        reportId: number
    ) {
        if (!context) {
            throw new BadRequestException("Context is required");
        }
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);

        const report = await this.db.report.findFirst({
            where: {
                id: reportId,
                OR: [{ account_id: accountId }, { is_system: true }],
            },
        });
        if (!report) {
            throw new NotFoundException("Report not found");
        }

        await this.db.userDefaultReport.upsert({
            where: {
                user_id_context: { user_id: userId, context },
            },
            create: {
                user_id: userId,
                context,
                report_id: reportId,
            },
            update: { report_id: reportId },
        });
        return { success: true, reportId };
    }

    async clearUserDefault(user: JwtPayload, context: string) {
        if (!context) {
            throw new BadRequestException("Context is required");
        }
        const userInfo = await this.access.resolveUserInfo(user);
        const userId = this.access.getEffectiveUserId(userInfo);
        await this.db.userDefaultReport.deleteMany({
            where: { user_id: userId, context },
        });
        return { success: true };
    }

    async listShares(user: JwtPayload, reportId: number) {
        await this.getById(user, reportId);
        const shares = await this.db.reportShare.findMany({
            where: { report_id: reportId },
        });
        return serializeBigInt({ shares });
    }

    async upsertShare(
        user: JwtPayload,
        reportId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.access.resolveUserInfo(user);
        const userId = this.access.getEffectiveUserId(userInfo);
        await this.getById(user, reportId);
        const created = await this.db.reportShare.create({
            data: {
                report_id: reportId,
                shared_with_user_id: (body.shared_with_user_id as string) || null,
                shared_with_role: (body.shared_with_role as never) || null,
                permission: String(body.permission || "view"),
                created_by: userId,
            },
        });
        return serializeBigInt(created);
    }

    async listSchedules(user: JwtPayload, reportId: number) {
        await this.getById(user, reportId);
        const schedules = await this.db.reportSchedule.findMany({
            where: { report_id: reportId },
        });
        return serializeBigInt({ schedules });
    }

    async upsertSchedule(
        user: JwtPayload,
        reportId: number,
        body: Record<string, unknown>
    ) {
        await this.getById(user, reportId);
        if (body.id) {
            const updated = await this.db.reportSchedule.update({
                where: { id: Number(body.id) },
                data: {
                    schedule_type: String(
                        body.schedule_type || "cron"
                    ),
                    schedule_config: (body.schedule_config as never) || {},
                    is_active: body.is_active as boolean,
                    next_run_at: body.next_run_at
                        ? new Date(String(body.next_run_at))
                        : undefined,
                },
            });
            return serializeBigInt(updated);
        }
        const created = await this.db.reportSchedule.create({
            data: {
                report_id: reportId,
                schedule_type: String(body.schedule_type || "cron"),
                schedule_config: (body.schedule_config as never) || {
                    cron: "0 8 * * 1",
                },
                is_active: body.is_active !== false,
            },
        });
        return serializeBigInt(created);
    }

    async syncSystem(user: JwtPayload) {
        const userInfo = await this.access.resolveUserInfo(user);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (
            role !== "System_Administrator" &&
            role !== "archaser_admin"
        ) {
            throw new ForbiddenException("Admin only");
        }
        // Nest-native: no seed sync from pages; acknowledge for UI tools
        return {
            success: true,
            synced: 0,
            message: "System report sync is managed via Nest seed jobs",
        };
    }

    private async resolveDefaultView(
        accountId: number,
        userId: string,
        context: string,
        _role: string,
        filterCi: boolean
    ) {
        const userDefault = await this.db.userDefaultReport.findFirst({
            where: { user_id: userId, context },
            include: { Report: true },
        });
        if (userDefault?.Report) {
            return userDefault.Report;
        }

        const where: Record<string, unknown> = {
            context,
            is_default: true,
            OR: [{ account_id: accountId }, { is_system: true }],
        };
        if (filterCi) {
            where.NOT = {
                OR: [
                    { context: { contains: "credit" } },
                    { unique_name: { contains: "credit_insurance" } },
                ],
            };
        }
        return this.db.report.findFirst({
            where: where as never,
            orderBy: [{ is_system: "desc" }, { modified_at: "desc" }],
        });
    }

    private async assertListPermission(
        accountId: number,
        role: string,
        context: string | undefined
    ) {
        if (await this.access.hasPermission(accountId, role, "view_reports")) {
            return;
        }
        if (context && ENTITY_LIST_REPORT_CONTEXTS.has(context)) {
            if (
                await this.access.hasPermission(
                    accountId,
                    role,
                    "view_customers"
                )
            ) {
                return;
            }
            if (
                (context === "contacts" || context === "customer_contacts") &&
                (await this.access.hasPermission(
                    accountId,
                    role,
                    "view_contacts"
                ))
            ) {
                return;
            }
        }
        if (context && DASHBOARD_REPORT_CONTEXTS.has(context)) {
            if (
                FINANCIAL_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(
                    accountId,
                    role,
                    "view_financial_dashboard"
                ))
            ) {
                return;
            }
            if (
                OPERATION_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(
                    accountId,
                    role,
                    "view_operation_dashboard"
                ))
            ) {
                return;
            }
            if (
                CREDIT_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(
                    accountId,
                    role,
                    "view_credit_dashboard"
                ))
            ) {
                return;
            }
        }
        throw new ForbiddenException(
            "You do not have permission to view reports"
        );
    }

    private formatReportDates<T extends Record<string, unknown>>(report: T) {
        return {
            ...report,
            created_at_formatted: report.created_at
                ? new Date(report.created_at as string | Date).toISOString()
                : null,
            modified_at_formatted: report.modified_at
                ? new Date(report.modified_at as string | Date).toISOString()
                : null,
        };
    }
}
