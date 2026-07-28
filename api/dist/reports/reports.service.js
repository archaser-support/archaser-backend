"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const report_constants_1 = require("./report.constants");
const report_metadata_1 = require("./report-metadata");
const report_relationships_1 = require("./report-relationships");
let ReportsService = class ReportsService {
    constructor(db, access) {
        this.db = db;
        this.access = access;
    }
    async list(user, query) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const context = query.context;
        const isDefaultRequest = query.default === "true" || query.default === "1";
        await this.assertListPermission(accountId, role, context);
        const accountRow = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        const filterCi = !accountRow
            ?.has_credit_insurance;
        if (isDefaultRequest && context) {
            const defaultView = await this.resolveDefaultView(accountId, userId, context, role, filterCi);
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
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "20", 10) || 20));
        const search = (query.search || "").trim();
        const sortField = query.sortField || "modified_at";
        const sortDirection = (query.sortDirection || "desc").toLowerCase() === "asc"
            ? "asc"
            : "desc";
        const where = {
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
                                        { shared_with_role: role },
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
            where.AND.push({ context });
        }
        if (search) {
            where.AND.push({
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
            where.AND.push({
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
            [allowedSort.has(sortField) ? sortField : "modified_at"]: sortDirection,
        };
        const [rows, totalRecords] = await Promise.all([
            this.db.report.findMany({
                where: where,
                orderBy: orderBy,
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.report.count({ where: where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({
            reports: rows.map((r) => this.formatReportDates(r)),
            totalRecords,
            page,
            limit,
        });
    }
    async getById(user, id) {
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
            throw new common_1.NotFoundException("Report not found");
        }
        return (0, serialize_bigint_1.serializeBigInt)({
            report: this.formatReportDates(report),
        });
    }
    async create(user, body) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (!(await this.access.hasPermission(accountId, role, "manage_reports")) &&
            !(await this.access.hasPermission(accountId, role, "view_reports"))) {
            throw new common_1.ForbiddenException("Cannot create reports");
        }
        const name = String(body.name || "").trim();
        if (!name) {
            throw new common_1.BadRequestException("name is required");
        }
        const unique_name = String(body.unique_name || name)
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .slice(0, 200) || `report_${Date.now()}`;
        const created = await this.db.report.create({
            data: {
                account_id: accountId,
                name,
                unique_name,
                description: body.description || null,
                report_config: body.report_config || {
                    tables: [],
                    fields: [],
                    filters: [],
                },
                is_public: Boolean(body.is_public),
                is_system: false,
                is_default: Boolean(body.is_default),
                context: body.context || null,
                created_by: userId,
                modified_by: userId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            report: this.formatReportDates(created),
        });
    }
    async update(user, id, body) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const existing = await this.db.report.findFirst({
            where: { id, account_id: accountId, is_system: false },
        });
        if (!existing) {
            throw new common_1.NotFoundException("Report not found");
        }
        const data = { modified_by: userId };
        for (const key of [
            "name",
            "description",
            "report_config",
            "is_public",
            "is_default",
            "context",
            "unique_name",
        ]) {
            if (body[key] !== undefined) {
                data[key] = body[key];
            }
        }
        const updated = await this.db.report.update({
            where: { id },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)({
            report: this.formatReportDates(updated),
        });
    }
    async remove(user, id) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const existing = await this.db.report.findFirst({
            where: { id, account_id: accountId, is_system: false },
        });
        if (!existing) {
            throw new common_1.NotFoundException("Report not found");
        }
        await this.db.report.delete({ where: { id } });
        return { success: true };
    }
    async metadata(user) {
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (!(await this.access.hasPermission(accountId, role, "view_reports"))) {
            throw new common_1.ForbiddenException("You do not have permission to view report metadata");
        }
        return {
            tables: report_metadata_1.REPORT_METADATA.tables,
            relationships: report_relationships_1.REPORT_RELATIONSHIPS,
        };
    }
    async getUserDefault(user, context) {
        if (!context) {
            throw new common_1.BadRequestException("Context is required");
        }
        const userInfo = await this.access.resolveUserInfo(user);
        const accountId = this.access.getEffectiveAccountId(userInfo);
        const userId = this.access.getEffectiveUserId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        await this.assertListPermission(accountId, role, context);
        const accountRow = await this.db.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        const filterCi = !accountRow
            ?.has_credit_insurance;
        const view = await this.resolveDefaultView(accountId, userId, context, role, filterCi);
        return (0, serialize_bigint_1.serializeBigInt)({
            report: view ? this.formatReportDates(view) : null,
        });
    }
    async setUserDefault(user, context, reportId) {
        if (!context) {
            throw new common_1.BadRequestException("Context is required");
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
            throw new common_1.NotFoundException("Report not found");
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
    async clearUserDefault(user, context) {
        if (!context) {
            throw new common_1.BadRequestException("Context is required");
        }
        const userInfo = await this.access.resolveUserInfo(user);
        const userId = this.access.getEffectiveUserId(userInfo);
        await this.db.userDefaultReport.deleteMany({
            where: { user_id: userId, context },
        });
        return { success: true };
    }
    async listShares(user, reportId) {
        await this.getById(user, reportId);
        const shares = await this.db.reportShare.findMany({
            where: { report_id: reportId },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ shares });
    }
    async upsertShare(user, reportId, body) {
        const userInfo = await this.access.resolveUserInfo(user);
        const userId = this.access.getEffectiveUserId(userInfo);
        await this.getById(user, reportId);
        const created = await this.db.reportShare.create({
            data: {
                report_id: reportId,
                shared_with_user_id: body.shared_with_user_id || null,
                shared_with_role: body.shared_with_role || null,
                permission: String(body.permission || "view"),
                created_by: userId,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(created);
    }
    async listSchedules(user, reportId) {
        await this.getById(user, reportId);
        const schedules = await this.db.reportSchedule.findMany({
            where: { report_id: reportId },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ schedules });
    }
    async upsertSchedule(user, reportId, body) {
        await this.getById(user, reportId);
        if (body.id) {
            const updated = await this.db.reportSchedule.update({
                where: { id: Number(body.id) },
                data: {
                    schedule_type: String(body.schedule_type || "cron"),
                    schedule_config: body.schedule_config || {},
                    is_active: body.is_active,
                    next_run_at: body.next_run_at
                        ? new Date(String(body.next_run_at))
                        : undefined,
                },
            });
            return (0, serialize_bigint_1.serializeBigInt)(updated);
        }
        const created = await this.db.reportSchedule.create({
            data: {
                report_id: reportId,
                schedule_type: String(body.schedule_type || "cron"),
                schedule_config: body.schedule_config || {
                    cron: "0 8 * * 1",
                },
                is_active: body.is_active !== false,
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)(created);
    }
    async syncSystem(user) {
        const userInfo = await this.access.resolveUserInfo(user);
        const role = userInfo.viewAsUserRole || userInfo.role;
        if (role !== "System_Administrator" &&
            role !== "archaser_admin") {
            throw new common_1.ForbiddenException("Admin only");
        }
        return {
            success: true,
            synced: 0,
            message: "System report sync is managed via Nest seed jobs",
        };
    }
    async resolveDefaultView(accountId, userId, context, _role, filterCi) {
        const userDefault = await this.db.userDefaultReport.findFirst({
            where: { user_id: userId, context },
            include: { Report: true },
        });
        if (userDefault?.Report) {
            return userDefault.Report;
        }
        const where = {
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
            where: where,
            orderBy: [{ is_system: "desc" }, { modified_at: "desc" }],
        });
    }
    async assertListPermission(accountId, role, context) {
        if (await this.access.hasPermission(accountId, role, "view_reports")) {
            return;
        }
        if (context && report_constants_1.ENTITY_LIST_REPORT_CONTEXTS.has(context)) {
            if (await this.access.hasPermission(accountId, role, "view_customers")) {
                return;
            }
            if ((context === "contacts" || context === "customer_contacts") &&
                (await this.access.hasPermission(accountId, role, "view_contacts"))) {
                return;
            }
        }
        if (context && report_constants_1.DASHBOARD_REPORT_CONTEXTS.has(context)) {
            if (report_constants_1.FINANCIAL_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(accountId, role, "view_financial_dashboard"))) {
                return;
            }
            if (report_constants_1.OPERATION_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(accountId, role, "view_operation_dashboard"))) {
                return;
            }
            if (report_constants_1.CREDIT_DASHBOARD_CONTEXTS.has(context) &&
                (await this.access.hasPermission(accountId, role, "view_credit_dashboard"))) {
                return;
            }
        }
        throw new common_1.ForbiddenException("You do not have permission to view reports");
    }
    formatReportDates(report) {
        return {
            ...report,
            created_at_formatted: report.created_at
                ? new Date(report.created_at).toISOString()
                : null,
            modified_at_formatted: report.modified_at
                ? new Date(report.modified_at).toISOString()
                : null,
        };
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], ReportsService);
//# sourceMappingURL=reports.service.js.map